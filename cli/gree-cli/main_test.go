package main

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

type fakeAdapter struct {
	statuses     map[string]StatusRecord
	lastScanWait time.Duration
	ignoreWrites bool
}

func newFakeAdapter(statuses ...StatusRecord) *fakeAdapter {
	m := map[string]StatusRecord{}
	for _, status := range statuses {
		m[status.MAC] = status
	}
	return &fakeAdapter{statuses: m}
}

func (a *fakeAdapter) Discover(scanWait time.Duration) ([]DeviceHandle, error) {
	a.lastScanWait = scanWait
	handles := make([]DeviceHandle, 0, len(a.statuses))
	for _, status := range a.statuses {
		record := DeviceRecord{IP: status.IP, Port: status.Port, MAC: status.MAC, Name: status.Name, Brand: status.Brand, Model: status.Model, Version: status.Version}
		handles = append(handles, DeviceHandle{Record: record, Raw: status.MAC})
	}
	return handles, nil
}

func (a *fakeAdapter) ReadStatus(handle DeviceHandle) (StatusRecord, error) {
	status, ok := a.statuses[handle.Raw.(string)]
	if !ok {
		return StatusRecord{}, errors.New("missing fake status")
	}
	return status, nil
}

func (a *fakeAdapter) Apply(handle DeviceHandle, command string, value any) (ChangeResult, error) {
	before, err := a.ReadStatus(handle)
	if err != nil {
		return ChangeResult{}, err
	}
	if a.ignoreWrites {
		return ChangeResult{Before: before, After: before}, nil
	}
	after := before
	switch command {
	case "temp":
		v := value.(int)
		after.TargetTemperature = &v
	case "power":
		v := value.(bool)
		after.Power = &v
	case "mode":
		after.Mode = value.(string)
	case "fan":
		after.FanSpeed = value.(string)
	}
	a.statuses[handle.Raw.(string)] = after
	return ChangeResult{Before: before, After: after}, nil
}

func status(mac, ip string) StatusRecord {
	power := true
	current := 72
	target := 70
	return StatusRecord{IP: ip, Port: 7000, MAC: mac, Name: "Bedroom", Brand: "GREE", Model: "MiniSplit", Version: "1.0", Power: &power, Mode: "cool", CurrentTemperature: &current, TargetTemperature: &target, Units: "F", FanSpeed: "auto"}
}

func runTestCLI(t *testing.T, args []string, adapter *fakeAdapter, store ConfigStore) (any, int, error) {
	t.Helper()
	payload, code, err := runCLI(args, NewService(adapter), store)
	if err == nil {
		if _, err := json.Marshal(payload); err != nil {
			t.Fatalf("payload is not JSON-serializable: %v", err)
		}
	}
	return payload, code, err
}

func testStore(t *testing.T) FileConfigStore {
	t.Helper()
	return NewConfigStore(filepath.Join(t.TempDir(), "config.toml"))
}

func TestConfigInitShowAndSetScanWait(t *testing.T) {
	store := testStore(t)
	adapter := newFakeAdapter()

	payload, code, err := runTestCLI(t, []string{"config", "init"}, adapter, store)
	if err != nil || code != 0 {
		t.Fatalf("config init code=%d err=%v", code, err)
	}
	if payload.(anyMap)["created"] != true {
		t.Fatalf("expected created=true, got %#v", payload)
	}

	_, code, err = runTestCLI(t, []string{"config", "set", "scan-wait", "3.5"}, adapter, store)
	if err != nil || code != 0 {
		t.Fatalf("config set code=%d err=%v", code, err)
	}

	payload, code, err = runTestCLI(t, []string{"config", "show"}, adapter, store)
	if err != nil || code != 0 {
		t.Fatalf("config show code=%d err=%v", code, err)
	}
	if got := payload.(anyMap)["scan_wait"]; got != 3.5 {
		t.Fatalf("scan_wait=%#v", got)
	}
}

func TestConfigSetDevicePrefersDiscoveredMAC(t *testing.T) {
	store := testStore(t)
	adapter := newFakeAdapter(status("aaaa1111bbbb", "192.168.1.10"))

	payload, code, err := runTestCLI(t, []string{"config", "set-device", "--ip", "192.168.1.10"}, adapter, store)
	if err != nil || code != 0 {
		t.Fatalf("set-device code=%d err=%v", code, err)
	}
	if got := payload.(anyMap)["preferred_mac"]; got != "aaaa1111bbbb" {
		t.Fatalf("preferred_mac=%#v", got)
	}
	config, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.PreferredMAC != "aaaa1111bbbb" || config.PreferredIP != "" {
		t.Fatalf("config=%#v", config)
	}
}

func TestStatusUsesConfiguredDevice(t *testing.T) {
	store := testStore(t)
	if err := store.Save(GreeConfig{PreferredMAC: "cccc2222dddd", ScanWaitSeconds: 2}); err != nil {
		t.Fatal(err)
	}
	first := status("aaaa1111bbbb", "192.168.1.10")
	second := status("cccc2222dddd", "192.168.1.20")
	second.Mode = "heat"
	adapter := newFakeAdapter(first, second)

	payload, code, err := runTestCLI(t, []string{"status"}, adapter, store)
	if err != nil || code != 0 {
		t.Fatalf("status code=%d err=%v", code, err)
	}
	got := payload.(StatusRecord)
	if got.MAC != "cccc2222dddd" || got.Mode != "heat" {
		t.Fatalf("status=%#v", got)
	}
}

func TestTempAliasAllowsFlagsAfterValue(t *testing.T) {
	store := testStore(t)
	adapter := newFakeAdapter(status("aaaa1111bbbb", "192.168.1.10"))

	payload, code, err := runTestCLI(t, []string{"temp", "68", "--mac", "aaaa:1111:bbbb"}, adapter, store)
	if err != nil || code != 0 {
		t.Fatalf("temp code=%d err=%v", code, err)
	}
	result := payload.(ChangeResult)
	if *result.Before.TargetTemperature != 70 || *result.After.TargetTemperature != 68 {
		t.Fatalf("result=%#v", result)
	}
}

func TestWriteVerificationFailureReturnsExitCode2(t *testing.T) {
	store := testStore(t)
	adapter := newFakeAdapter(status("aaaa1111bbbb", "192.168.1.10"))
	adapter.ignoreWrites = true

	_, code, err := runTestCLI(t, []string{"temp", "68", "--mac", "aaaa1111bbbb"}, adapter, store)
	if err == nil || code != 2 {
		t.Fatalf("code=%d err=%v", code, err)
	}
	var verify VerificationError
	var coded codedError
	if !errors.As(err, &verify) && !errors.As(err, &coded) {
		t.Fatalf("expected verification error, got %T", err)
	}
}
