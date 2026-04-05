from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from typing import Sequence, TextIO

from .config import ConfigStore, GreeConfig
from .service import (
    FAN_CHOICES,
    MODE_CHOICES,
    DeviceSelector,
    GreeError,
    GreeService,
    VerificationError,
)


def positive_float(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be a number") from exc
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be greater than 0")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gree",
        description="Discover and control local GREE HVAC units over the LAN.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    devices = subparsers.add_parser("devices", help="List discovered GREE devices.")
    add_scan_wait_arg(devices)
    add_json_arg(devices)
    devices.set_defaults(handler=handle_devices)

    status = subparsers.add_parser("status", help="Read current status from a GREE device.")
    add_selector_args(status)
    add_scan_wait_arg(status)
    add_json_arg(status)
    status.set_defaults(handler=handle_status)

    set_cmd = subparsers.add_parser("set", help="Change a GREE device setting.")
    set_subparsers = set_cmd.add_subparsers(dest="set_command", required=True)

    set_temp = set_subparsers.add_parser("temp", help="Set target temperature.")
    add_selector_args(set_temp)
    add_scan_wait_arg(set_temp)
    add_json_arg(set_temp)
    set_temp.add_argument("temperature", type=int, help="Target temperature in the device's active units.")
    set_temp.set_defaults(handler=handle_set_temp)

    set_power = set_subparsers.add_parser("power", help="Set power state.")
    add_selector_args(set_power)
    add_scan_wait_arg(set_power)
    add_json_arg(set_power)
    set_power.add_argument("power", choices=("on", "off"))
    set_power.set_defaults(handler=handle_set_power)

    set_mode = set_subparsers.add_parser("mode", help="Set operating mode.")
    add_selector_args(set_mode)
    add_scan_wait_arg(set_mode)
    add_json_arg(set_mode)
    set_mode.add_argument("mode", choices=MODE_CHOICES)
    set_mode.set_defaults(handler=handle_set_mode)

    set_fan = set_subparsers.add_parser("fan", help="Set fan speed.")
    add_selector_args(set_fan)
    add_scan_wait_arg(set_fan)
    add_json_arg(set_fan)
    set_fan.add_argument("fan_speed", choices=FAN_CHOICES)
    set_fan.set_defaults(handler=handle_set_fan)

    temp_alias = subparsers.add_parser("temp", help="Alias for `set temp`.")
    add_selector_args(temp_alias)
    add_scan_wait_arg(temp_alias)
    add_json_arg(temp_alias)
    temp_alias.add_argument("temperature", type=int, help="Target temperature in the device's active units.")
    temp_alias.set_defaults(handler=handle_set_temp)

    on_alias = subparsers.add_parser("on", help="Alias for `set power on`.")
    add_selector_args(on_alias)
    add_scan_wait_arg(on_alias)
    add_json_arg(on_alias)
    on_alias.set_defaults(handler=handle_on)

    off_alias = subparsers.add_parser("off", help="Alias for `set power off`.")
    add_selector_args(off_alias)
    add_scan_wait_arg(off_alias)
    add_json_arg(off_alias)
    off_alias.set_defaults(handler=handle_off)

    mode_alias = subparsers.add_parser("mode", help="Alias for `set mode`.")
    add_selector_args(mode_alias)
    add_scan_wait_arg(mode_alias)
    add_json_arg(mode_alias)
    mode_alias.add_argument("mode", choices=MODE_CHOICES)
    mode_alias.set_defaults(handler=handle_set_mode)

    fan_alias = subparsers.add_parser("fan", help="Alias for `set fan`.")
    add_selector_args(fan_alias)
    add_scan_wait_arg(fan_alias)
    add_json_arg(fan_alias)
    fan_alias.add_argument("fan_speed", choices=FAN_CHOICES)
    fan_alias.set_defaults(handler=handle_set_fan)

    config = subparsers.add_parser("config", help="Manage repo-local defaults.")
    config_subparsers = config.add_subparsers(dest="config_command", required=True)

    config_init = config_subparsers.add_parser("init", help="Create the repo-local config file.")
    config_init.set_defaults(handler=handle_config_init)

    config_show = config_subparsers.add_parser("show", help="Show the current config values.")
    add_json_arg(config_show)
    config_show.set_defaults(handler=handle_config_show)

    config_set_device = config_subparsers.add_parser("set-device", help="Choose the default target device.")
    config_set_device.add_argument("--ip", help="Preferred IPv4 address.")
    config_set_device.add_argument("--mac", help="Preferred MAC address.")
    add_scan_wait_arg(config_set_device)
    config_set_device.set_defaults(handler=handle_config_set_device)

    config_clear_device = config_subparsers.add_parser("clear-device", help="Clear the preferred device.")
    config_clear_device.set_defaults(handler=handle_config_clear_device)

    config_set = config_subparsers.add_parser("set", help="Update a config value.")
    config_set_subparsers = config_set.add_subparsers(dest="config_set_command", required=True)

    config_set_scan_wait = config_set_subparsers.add_parser("scan-wait", help="Set the default discovery timeout.")
    config_set_scan_wait.add_argument("scan_wait", type=positive_float)
    config_set_scan_wait.set_defaults(handler=handle_config_set_scan_wait)

    return parser


def add_selector_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--ip", help="Target a specific IPv4 address.")
    parser.add_argument("--mac", help="Target a specific MAC address.")


def add_scan_wait_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--scan-wait",
        type=positive_float,
        default=None,
        help="Seconds to wait for discovery replies.",
    )


def add_json_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true", help="Emit JSON.")


def main(argv: Sequence[str] | None = None) -> int:
    return run_cli(sys.argv[1:] if argv is None else argv)


def run_cli(
    argv: Sequence[str],
    *,
    service: GreeService | None = None,
    config_store: ConfigStore | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv))
    service = service or GreeService()
    config_store = config_store or ConfigStore()
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr

    try:
        return args.handler(args, service, config_store, stdout, stderr)
    except VerificationError as exc:
        print(str(exc), file=stderr)
        return 2
    except GreeError as exc:
        print(str(exc), file=stderr)
        return 1


def handle_devices(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    scan_wait = effective_scan_wait(args, config)
    records = service.list_devices(scan_wait)
    if args.json:
        dump_json([record.to_dict() for record in records], stdout)
        return 0

    if not records:
        print("No GREE devices found.", file=stdout)
        return 0

    for record in records:
        print(
            f"{record.ip} mac={record.mac} name={display(record.name)} "
            f"brand={display(record.brand)} model={display(record.model)} version={display(record.version)}",
            file=stdout,
        )
    return 0


def handle_status(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    scan_wait = effective_scan_wait(args, config)
    selector = selector_from_args(args)
    status = service.get_status(selector, config, scan_wait)
    if args.json:
        dump_json(status.to_dict(), stdout)
        return 0
    print(format_status(status), file=stdout)
    return 0


def handle_set_temp(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    scan_wait = effective_scan_wait(args, config)
    selector = selector_from_args(args)
    result = service.set_temperature(selector, config, scan_wait, args.temperature)
    return emit_change(result, args.json, stdout)


def handle_set_power(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    scan_wait = effective_scan_wait(args, config)
    selector = selector_from_args(args)
    result = service.set_power(selector, config, scan_wait, args.power == "on")
    return emit_change(result, args.json, stdout)


def handle_on(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    stderr: TextIO,
) -> int:
    power_args = argparse.Namespace(**vars(args), power="on")
    return handle_set_power(power_args, service, config_store, stdout, stderr)


def handle_off(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    stderr: TextIO,
) -> int:
    power_args = argparse.Namespace(**vars(args), power="off")
    return handle_set_power(power_args, service, config_store, stdout, stderr)


def handle_set_mode(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    scan_wait = effective_scan_wait(args, config)
    selector = selector_from_args(args)
    result = service.set_mode(selector, config, scan_wait, args.mode)
    return emit_change(result, args.json, stdout)


def handle_set_fan(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    scan_wait = effective_scan_wait(args, config)
    selector = selector_from_args(args)
    result = service.set_fan(selector, config, scan_wait, args.fan_speed)
    return emit_change(result, args.json, stdout)


def handle_config_init(
    _args: argparse.Namespace,
    _service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    created = config_store.init()
    if created:
        print(f"Initialized {config_store.path}", file=stdout)
    else:
        print(f"Config already exists at {config_store.path}", file=stdout)
    return 0


def handle_config_show(
    args: argparse.Namespace,
    _service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    payload = {
        "path": str(config_store.path),
        "exists": config_store.exists(),
        **config.to_dict(),
    }
    if args.json:
        dump_json(payload, stdout)
        return 0

    print(f"path={config_store.path}", file=stdout)
    print(f"exists={'yes' if payload['exists'] else 'no'}", file=stdout)
    print(f"scan_wait={config.scan_wait}", file=stdout)
    print(f"preferred_mac={config.preferred_mac or '-'}", file=stdout)
    print(f"preferred_ip={config.preferred_ip or '-'}", file=stdout)
    return 0


def handle_config_set_device(
    args: argparse.Namespace,
    service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    if not args.mac and not args.ip:
        raise GreeError("config set-device requires --mac or --ip.")

    config = config_store.load()
    selector = selector_from_args(args)
    scan_wait = effective_scan_wait(args, config)
    record = service.resolve_device(selector, config=GreeConfig(), scan_wait=scan_wait)
    updated = replace(
        config,
        preferred_mac=record.mac or None,
        preferred_ip=None if record.mac else record.ip,
    )
    config_store.save(updated)
    print(f"Preferred device set to mac={record.mac} ip={record.ip}", file=stdout)
    return 0


def handle_config_clear_device(
    _args: argparse.Namespace,
    _service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    updated = replace(config, preferred_mac=None, preferred_ip=None)
    config_store.save(updated)
    print("Cleared preferred device.", file=stdout)
    return 0


def handle_config_set_scan_wait(
    args: argparse.Namespace,
    _service: GreeService,
    config_store: ConfigStore,
    stdout: TextIO,
    _stderr: TextIO,
) -> int:
    config = config_store.load()
    updated = replace(config, scan_wait=args.scan_wait)
    config_store.save(updated)
    print(f"Default scan_wait set to {args.scan_wait}", file=stdout)
    return 0


def selector_from_args(args: argparse.Namespace) -> DeviceSelector:
    return DeviceSelector(ip=getattr(args, "ip", None), mac=getattr(args, "mac", None))


def effective_scan_wait(args: argparse.Namespace, config: GreeConfig) -> float:
    return args.scan_wait if getattr(args, "scan_wait", None) is not None else config.scan_wait


def emit_change(result, json_mode: bool, stdout: TextIO) -> int:
    if json_mode:
        dump_json(result.to_dict(), stdout)
        return 0
    print(format_change(result.before, result.after), file=stdout)
    return 0


def format_status(status) -> str:
    current = format_temperature(status.current_temperature, status.units)
    target = format_temperature(status.target_temperature, status.units)
    power = "on" if status.power else "off"
    return (
        f"{status.ip} {display(status.mode)} power={power} "
        f"current={current} target={target} fan={display(status.fan_speed)}"
    )


def format_change(before, after) -> str:
    current = format_temperature(after.current_temperature, after.units)
    target_before = format_temperature(before.target_temperature, before.units)
    target_after = format_temperature(after.target_temperature, after.units)
    power = "on" if after.power else "off"
    return (
        f"{after.ip} power={power} target {target_before} -> {target_after} "
        f"current={current} mode={display(after.mode)} fan={display(after.fan_speed)}"
    )


def format_temperature(value: int | None, units: str | None) -> str:
    if value is None:
        return "-"
    return f"{value}{units or ''}"


def dump_json(payload: object, stdout: TextIO) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True), file=stdout)


def display(value: object | None) -> str:
    if value in (None, ""):
        return "-"
    return str(value)
