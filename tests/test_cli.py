from io import StringIO
import json

from gree.cli import run_cli
from gree.config import ConfigStore
from gree.service import GreeService

from .test_service import FakeAdapter, make_record, make_status


def run_command(argv, *, service, config_store):
    stdout = StringIO()
    stderr = StringIO()
    code = run_cli(argv, service=service, config_store=config_store, stdout=stdout, stderr=stderr)
    return code, stdout.getvalue(), stderr.getvalue()


def test_config_init_show_and_set_scan_wait(tmp_path):
    store = ConfigStore(tmp_path / "config.toml")
    service = GreeService(adapter=FakeAdapter([]))

    code, stdout, stderr = run_command(["config", "init"], service=service, config_store=store)
    assert code == 0
    assert "Initialized" in stdout
    assert stderr == ""

    code, stdout, _ = run_command(["config", "set", "scan-wait", "3.5"], service=service, config_store=store)
    assert code == 0
    assert "3.5" in stdout

    code, stdout, _ = run_command(["config", "show", "--json"], service=service, config_store=store)
    payload = json.loads(stdout)
    assert code == 0
    assert payload["scan_wait"] == 3.5
    assert payload["exists"] is True


def test_config_set_device_prefers_discovered_mac(tmp_path):
    record = make_record("aaaa1111bbbb", "192.168.1.10")
    status = make_status(record)
    service = GreeService(adapter=FakeAdapter([status]))
    store = ConfigStore(tmp_path / "config.toml")

    code, stdout, stderr = run_command(
        ["config", "set-device", "--ip", "192.168.1.10"],
        service=service,
        config_store=store,
    )

    assert code == 0
    assert "mac=aaaa1111bbbb" in stdout
    assert stderr == ""
    config = store.load()
    assert config.preferred_mac == "aaaa1111bbbb"
    assert config.preferred_ip is None


def test_status_json_uses_config_selected_device(tmp_path):
    first = make_status(make_record("aaaa1111bbbb", "192.168.1.10"))
    second = make_status(make_record("cccc2222dddd", "192.168.1.20"), mode="heat")
    service = GreeService(adapter=FakeAdapter([first, second]))
    store = ConfigStore(tmp_path / "config.toml")
    store.save(store.load().__class__(preferred_mac="cccc2222dddd", scan_wait=2.0))

    code, stdout, stderr = run_command(["status", "--json"], service=service, config_store=store)

    payload = json.loads(stdout)
    assert code == 0
    assert stderr == ""
    assert payload["mac"] == "cccc2222dddd"
    assert payload["mode"] == "heat"


def test_temp_alias_emits_human_change_output(tmp_path):
    record = make_record("aaaa1111bbbb", "192.168.1.10")
    status = make_status(record, target_temperature=70)
    service = GreeService(adapter=FakeAdapter([status]))
    store = ConfigStore(tmp_path / "config.toml")

    code, stdout, stderr = run_command(["temp", "68", "--mac", "aaaa1111bbbb"], service=service, config_store=store)

    assert code == 0
    assert stderr == ""
    assert "70F -> 68F" in stdout


def test_write_verification_failure_returns_exit_code_2(tmp_path):
    record = make_record("aaaa1111bbbb", "192.168.1.10")
    status = make_status(record)
    adapter = FakeAdapter([status])
    adapter.ignore_writes = True
    service = GreeService(adapter=adapter)
    store = ConfigStore(tmp_path / "config.toml")

    code, stdout, stderr = run_command(["temp", "68", "--mac", "aaaa1111bbbb"], service=service, config_store=store)

    assert code == 2
    assert stdout == ""
    assert "read-back verification failed" in stderr
