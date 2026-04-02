from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Protocol

from .config import GreeConfig


MODE_CHOICES = ("auto", "cool", "dry", "fan", "heat")
FAN_CHOICES = ("auto", "low", "medium-low", "medium", "medium-high", "high")


def normalize_mac(value: str | None) -> str | None:
    if not value:
        return None
    return "".join(ch for ch in value.lower() if ch in "0123456789abcdef")


@dataclass(frozen=True)
class DeviceSelector:
    ip: str | None = None
    mac: str | None = None

    def normalized(self) -> "DeviceSelector":
        return DeviceSelector(ip=self.ip, mac=normalize_mac(self.mac))

    def is_set(self) -> bool:
        return bool(self.ip or self.mac)


@dataclass(frozen=True)
class DeviceRecord:
    ip: str
    port: int
    mac: str
    name: str | None
    brand: str | None
    model: str | None
    version: str | None

    def to_dict(self) -> dict[str, object | None]:
        return {
            "ip": self.ip,
            "port": self.port,
            "mac": self.mac,
            "name": self.name,
            "brand": self.brand,
            "model": self.model,
            "version": self.version,
        }


@dataclass(frozen=True)
class DeviceHandle:
    record: DeviceRecord
    raw: Any


@dataclass(frozen=True)
class StatusRecord:
    ip: str
    port: int
    mac: str
    name: str | None
    brand: str | None
    model: str | None
    version: str | None
    power: bool | None
    mode: str | None
    current_temperature: int | None
    target_temperature: int | None
    units: str | None
    fan_speed: str | None

    def to_dict(self) -> dict[str, object | None]:
        return {
            "ip": self.ip,
            "port": self.port,
            "mac": self.mac,
            "name": self.name,
            "brand": self.brand,
            "model": self.model,
            "version": self.version,
            "power": self.power,
            "mode": self.mode,
            "current_temperature": self.current_temperature,
            "target_temperature": self.target_temperature,
            "units": self.units,
            "fan_speed": self.fan_speed,
        }


@dataclass(frozen=True)
class ChangeResult:
    before: StatusRecord
    after: StatusRecord

    def to_dict(self) -> dict[str, object]:
        return {
            "before": self.before.to_dict(),
            "after": self.after.to_dict(),
        }


class GreeError(Exception):
    """Base error for CLI-facing failures."""


class DeviceSelectionError(GreeError):
    """Raised when discovery cannot resolve to one device."""


class VerificationError(GreeError):
    """Raised when a write does not read back as expected."""


class GreeAdapter(Protocol):
    def discover(self, scan_wait: float) -> list[DeviceHandle]:
        ...

    def read_status(self, handle: DeviceHandle) -> StatusRecord:
        ...

    def apply(self, handle: DeviceHandle, command: str, value: object) -> ChangeResult:
        ...


class GreeService:
    def __init__(self, adapter: GreeAdapter | None = None):
        self.adapter = adapter or LiveGreeAdapter()

    def list_devices(self, scan_wait: float) -> list[DeviceRecord]:
        return [handle.record for handle in self.adapter.discover(scan_wait)]

    def get_status(
        self,
        selector: DeviceSelector,
        config: GreeConfig,
        scan_wait: float,
    ) -> StatusRecord:
        handle = self._resolve_handle(selector, config, scan_wait)
        return self.adapter.read_status(handle)

    def set_temperature(
        self,
        selector: DeviceSelector,
        config: GreeConfig,
        scan_wait: float,
        temperature: int,
    ) -> ChangeResult:
        return self._apply_and_verify(
            selector,
            config,
            scan_wait,
            "temp",
            temperature,
            lambda status: status.target_temperature == temperature,
            f"Device reported target temperature {temperature}, but read-back verification failed.",
        )

    def set_power(
        self,
        selector: DeviceSelector,
        config: GreeConfig,
        scan_wait: float,
        power: bool,
    ) -> ChangeResult:
        return self._apply_and_verify(
            selector,
            config,
            scan_wait,
            "power",
            power,
            lambda status: status.power is power,
            f"Device reported power {power}, but read-back verification failed.",
        )

    def set_mode(
        self,
        selector: DeviceSelector,
        config: GreeConfig,
        scan_wait: float,
        mode: str,
    ) -> ChangeResult:
        if mode not in MODE_CHOICES:
            raise GreeError(f"Unsupported mode: {mode}")
        return self._apply_and_verify(
            selector,
            config,
            scan_wait,
            "mode",
            mode,
            lambda status: status.mode == mode,
            f"Device reported mode {mode}, but read-back verification failed.",
        )

    def set_fan(
        self,
        selector: DeviceSelector,
        config: GreeConfig,
        scan_wait: float,
        fan_speed: str,
    ) -> ChangeResult:
        if fan_speed not in FAN_CHOICES:
            raise GreeError(f"Unsupported fan speed: {fan_speed}")
        return self._apply_and_verify(
            selector,
            config,
            scan_wait,
            "fan",
            fan_speed,
            lambda status: status.fan_speed == fan_speed,
            f"Device reported fan speed {fan_speed}, but read-back verification failed.",
        )

    def resolve_device(
        self,
        selector: DeviceSelector,
        config: GreeConfig,
        scan_wait: float,
    ) -> DeviceRecord:
        return self._resolve_handle(selector, config, scan_wait).record

    def _apply_and_verify(
        self,
        selector: DeviceSelector,
        config: GreeConfig,
        scan_wait: float,
        command: str,
        value: object,
        verifier,
        error_message: str,
    ) -> ChangeResult:
        handle = self._resolve_handle(selector, config, scan_wait)
        result = self.adapter.apply(handle, command, value)
        if not verifier(result.after):
            raise VerificationError(error_message)
        return result

    def _resolve_handle(
        self,
        selector: DeviceSelector,
        config: GreeConfig,
        scan_wait: float,
    ) -> DeviceHandle:
        handles = self.adapter.discover(scan_wait)
        if not handles:
            raise DeviceSelectionError("No GREE devices found.")

        explicit = selector.normalized()
        config_selector = DeviceSelector(
            ip=config.preferred_ip,
            mac=config.preferred_mac,
        ).normalized()

        if explicit.is_set():
            return self._match_single(
                handles,
                explicit,
                "No GREE device matched the requested selectors.",
                "Multiple GREE devices matched the requested selectors. Rerun with a more specific selector.",
            )

        if config_selector.is_set():
            return self._match_single(
                handles,
                config_selector,
                "No GREE device matched the configured preferred device.",
                "Configured preferred device matched multiple GREE units. Update config or pass --mac/--ip.",
            )

        if len(handles) == 1:
            return handles[0]

        choices = ", ".join(f"{handle.record.ip}/{handle.record.mac}" for handle in handles)
        raise DeviceSelectionError(
            f"Multiple GREE devices matched. Rerun with --ip or --mac. Matches: {choices}"
        )

    @staticmethod
    def _match_single(
        handles: list[DeviceHandle],
        selector: DeviceSelector,
        none_message: str,
        many_message: str,
    ) -> DeviceHandle:
        matches = list(handles)
        if selector.ip:
            matches = [handle for handle in matches if handle.record.ip == selector.ip]
        if selector.mac:
            target_mac = normalize_mac(selector.mac)
            matches = [handle for handle in matches if handle.record.mac == target_mac]

        if not matches:
            raise DeviceSelectionError(none_message)
        if len(matches) > 1:
            raise DeviceSelectionError(many_message)
        return matches[0]


class LiveGreeAdapter:
    def __init__(self) -> None:
        self._runtime = None

    def discover(self, scan_wait: float) -> list[DeviceHandle]:
        runtime = self._ensure_runtime()
        return asyncio.run(self._discover_async(runtime, scan_wait))

    def read_status(self, handle: DeviceHandle) -> StatusRecord:
        runtime = self._ensure_runtime()
        return asyncio.run(self._read_status_async(runtime, handle.raw))

    def apply(self, handle: DeviceHandle, command: str, value: object) -> ChangeResult:
        runtime = self._ensure_runtime()
        return asyncio.run(self._apply_async(runtime, handle.raw, command, value))

    def _ensure_runtime(self) -> dict[str, Any]:
        if self._runtime is not None:
            return self._runtime

        from greeclimate.discovery import Discovery
        from greeclimate.device import Device, FanSpeed, Mode, TemperatureUnits

        logging.getLogger().setLevel(logging.WARNING)
        for name in (
            "asyncio",
            "greeclimate",
            "greeclimate.cipher",
            "greeclimate.device",
            "greeclimate.discovery",
            "greeclimate.network",
        ):
            logging.getLogger(name).setLevel(logging.WARNING)

        self._runtime = {
            "Discovery": Discovery,
            "Device": Device,
            "FanSpeed": FanSpeed,
            "Mode": Mode,
            "TemperatureUnits": TemperatureUnits,
        }
        return self._runtime

    async def _discover_async(self, runtime: dict[str, Any], scan_wait: float) -> list[DeviceHandle]:
        discovery = runtime["Discovery"](timeout=2)
        try:
            devices = await discovery.scan(wait_for=scan_wait)
        finally:
            discovery.close()

        return [
            DeviceHandle(
                record=DeviceRecord(
                    ip=info.ip,
                    port=info.port,
                    mac=normalize_mac(info.mac) or "",
                    name=info.name,
                    brand=info.brand,
                    model=info.model,
                    version=info.version,
                ),
                raw=info,
            )
            for info in devices
        ]

    async def _read_status_async(self, runtime: dict[str, Any], info: Any) -> StatusRecord:
        device = await self._connect_and_refresh(runtime["Device"], info)
        try:
            return self._status_from_device(
                runtime["FanSpeed"],
                runtime["Mode"],
                runtime["TemperatureUnits"],
                device,
            )
        finally:
            device.close()

    async def _apply_async(
        self,
        runtime: dict[str, Any],
        info: Any,
        command: str,
        value: object,
    ) -> ChangeResult:
        device = await self._connect_and_refresh(runtime["Device"], info)
        try:
            before = self._status_from_device(
                runtime["FanSpeed"],
                runtime["Mode"],
                runtime["TemperatureUnits"],
                device,
            )
            self._apply_to_device(runtime, device, command, value)
            await device.push_state_update()
            await asyncio.sleep(0.5)
            await device.update_state()
            await asyncio.sleep(0.5)
            after = self._status_from_device(
                runtime["FanSpeed"],
                runtime["Mode"],
                runtime["TemperatureUnits"],
                device,
            )
            return ChangeResult(before=before, after=after)
        finally:
            device.close()

    @staticmethod
    async def _connect_and_refresh(device_cls: type, info: Any):
        device = device_cls(info, timeout=5, bind_timeout=4)
        try:
            await device.bind()
            await asyncio.sleep(0.3)
            await device.update_state()
            await asyncio.sleep(0.3)
            return device
        except Exception:
            device.close()
            raise

    @staticmethod
    def _apply_to_device(runtime: dict[str, Any], device: Any, command: str, value: object) -> None:
        if command == "temp":
            device.target_temperature = int(value)
            return
        if command == "power":
            device.power = bool(value)
            return
        if command == "mode":
            mode_map = {
                "auto": runtime["Mode"].Auto,
                "cool": runtime["Mode"].Cool,
                "dry": runtime["Mode"].Dry,
                "fan": runtime["Mode"].Fan,
                "heat": runtime["Mode"].Heat,
            }
            device.mode = mode_map[str(value)].value
            return
        if command == "fan":
            fan_map = {
                "auto": runtime["FanSpeed"].Auto,
                "low": runtime["FanSpeed"].Low,
                "medium-low": runtime["FanSpeed"].MediumLow,
                "medium": runtime["FanSpeed"].Medium,
                "medium-high": runtime["FanSpeed"].MediumHigh,
                "high": runtime["FanSpeed"].High,
            }
            device.fan_speed = fan_map[str(value)].value
            return
        raise GreeError(f"Unsupported command: {command}")

    @staticmethod
    def _status_from_device(fan_enum: Any, mode_enum: Any, units_enum: Any, device: Any) -> StatusRecord:
        fan_map = {
            fan_enum.Auto.value: "auto",
            fan_enum.Low.value: "low",
            fan_enum.MediumLow.value: "medium-low",
            fan_enum.Medium.value: "medium",
            fan_enum.MediumHigh.value: "medium-high",
            fan_enum.High.value: "high",
        }
        mode_map = {
            mode_enum.Auto.value: "auto",
            mode_enum.Cool.value: "cool",
            mode_enum.Dry.value: "dry",
            mode_enum.Fan.value: "fan",
            mode_enum.Heat.value: "heat",
        }
        unit_map = {
            units_enum.C.value: "C",
            units_enum.F.value: "F",
        }
        info = device.device_info
        return StatusRecord(
            ip=info.ip,
            port=info.port,
            mac=normalize_mac(info.mac) or "",
            name=info.name,
            brand=info.brand,
            model=info.model,
            version=info.version,
            power=device.power,
            mode=mode_map.get(device.mode),
            current_temperature=device.current_temperature,
            target_temperature=device.target_temperature,
            units=unit_map.get(device.temperature_units),
            fan_speed=fan_map.get(device.fan_speed),
        )
