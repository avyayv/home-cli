from dataclasses import replace

import pytest

from gree.config import GreeConfig
from gree.service import (
    ChangeResult,
    DeviceHandle,
    DeviceRecord,
    DeviceSelectionError,
    DeviceSelector,
    GreeService,
    StatusRecord,
    VerificationError,
)


def make_record(mac: str, ip: str) -> DeviceRecord:
    return DeviceRecord(
        ip=ip,
        port=7000,
        mac=mac,
        name="Bedroom",
        brand="GREE",
        model="MiniSplit",
        version="1.0",
    )


def make_status(record: DeviceRecord, **overrides) -> StatusRecord:
    payload = {
        "ip": record.ip,
        "port": record.port,
        "mac": record.mac,
        "name": record.name,
        "brand": record.brand,
        "model": record.model,
        "version": record.version,
        "power": True,
        "mode": "cool",
        "current_temperature": 72,
        "target_temperature": 70,
        "units": "F",
        "fan_speed": "auto",
    }
    payload.update(overrides)
    return StatusRecord(**payload)


class FakeAdapter:
    def __init__(self, statuses: list[StatusRecord]):
        self.handles = [DeviceHandle(record=make_record(status.mac, status.ip), raw=status.mac) for status in statuses]
        self.statuses = {status.mac: status for status in statuses}
        self.last_scan_wait = None
        self.ignore_writes = False

    def discover(self, scan_wait: float) -> list[DeviceHandle]:
        self.last_scan_wait = scan_wait
        return list(self.handles)

    def read_status(self, handle: DeviceHandle) -> StatusRecord:
        return self.statuses[handle.raw]

    def apply(self, handle: DeviceHandle, command: str, value: object) -> ChangeResult:
        before = self.statuses[handle.raw]
        if self.ignore_writes:
            return ChangeResult(before=before, after=before)

        if command == "temp":
            after = replace(before, target_temperature=int(value))
        elif command == "power":
            after = replace(before, power=bool(value))
        elif command == "mode":
            after = replace(before, mode=str(value))
        elif command == "fan":
            after = replace(before, fan_speed=str(value))
        else:
            raise AssertionError(f"unsupported command in test: {command}")

        self.statuses[handle.raw] = after
        return ChangeResult(before=before, after=after)


def test_explicit_selector_overrides_config():
    first = make_status(make_record("aaaa1111bbbb", "192.168.1.10"))
    second = make_status(make_record("cccc2222dddd", "192.168.1.20"))
    adapter = FakeAdapter([first, second])
    service = GreeService(adapter=adapter)

    status = service.get_status(
        DeviceSelector(mac="aaaa:1111:bbbb"),
        GreeConfig(preferred_mac="cccc2222dddd"),
        1.5,
    )

    assert status.mac == "aaaa1111bbbb"
    assert adapter.last_scan_wait == 1.5


def test_config_selector_is_used_when_no_explicit_selector():
    first = make_status(make_record("aaaa1111bbbb", "192.168.1.10"))
    second = make_status(make_record("cccc2222dddd", "192.168.1.20"))
    service = GreeService(adapter=FakeAdapter([first, second]))

    status = service.get_status(
        DeviceSelector(),
        GreeConfig(preferred_mac="cccc2222dddd"),
        2.0,
    )

    assert status.mac == "cccc2222dddd"


def test_single_discovered_device_is_auto_selected():
    only = make_status(make_record("aaaa1111bbbb", "192.168.1.10"))
    service = GreeService(adapter=FakeAdapter([only]))

    status = service.get_status(DeviceSelector(), GreeConfig(), 2.0)

    assert status.ip == "192.168.1.10"


def test_multiple_devices_without_selector_raises():
    first = make_status(make_record("aaaa1111bbbb", "192.168.1.10"))
    second = make_status(make_record("cccc2222dddd", "192.168.1.20"))
    service = GreeService(adapter=FakeAdapter([first, second]))

    with pytest.raises(DeviceSelectionError):
        service.get_status(DeviceSelector(), GreeConfig(), 2.0)


def test_write_verification_failure_raises_exit_condition():
    only = make_status(make_record("aaaa1111bbbb", "192.168.1.10"))
    adapter = FakeAdapter([only])
    adapter.ignore_writes = True
    service = GreeService(adapter=adapter)

    with pytest.raises(VerificationError):
        service.set_temperature(DeviceSelector(), GreeConfig(), 2.0, 68)
