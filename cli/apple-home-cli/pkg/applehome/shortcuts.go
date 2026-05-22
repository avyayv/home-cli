package applehome

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const DefaultShortcutName = "Apple Home CLI Bridge"

type ShortcutsBackend struct {
	Shortcut string
}

func NewShortcutsBackend(name string) ShortcutsBackend {
	if name == "" {
		name = os.Getenv("APPLE_HOME_SHORTCUT")
	}
	if name == "" {
		name = DefaultShortcutName
	}
	return ShortcutsBackend{Shortcut: name}
}

func ListShortcuts() ([]string, error) {
	cmd := exec.Command("/usr/bin/shortcuts", "list")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var names []string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			names = append(names, line)
		}
	}
	return names, nil
}

func ShortcutExists(name string) (bool, error) {
	shortcuts, err := ListShortcuts()
	if err != nil {
		return false, err
	}
	for _, s := range shortcuts {
		if s == name {
			return true, nil
		}
	}
	return false, nil
}

func (s ShortcutsBackend) Exists() (bool, error) {
	return ShortcutExists(s.Shortcut)
}

func (s ShortcutsBackend) Run(payload map[string]any) error {
	exists, err := s.Exists()
	if err != nil {
		return fmt.Errorf("could not list shortcuts: %w", err)
	}
	if !exists {
		return fmt.Errorf("shortcut %q does not exist; run `apple-home shortcuts setup` for setup instructions", s.Shortcut)
	}

	f, err := os.CreateTemp("", "apple-home-*.json")
	if err != nil {
		return err
	}
	path := f.Name()
	defer os.Remove(path)
	var pretty bytes.Buffer
	enc := json.NewEncoder(&pretty)
	enc.SetIndent("", "  ")
	_ = enc.Encode(payload)
	if _, err := f.Write(pretty.Bytes()); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	cmd := exec.Command("/usr/bin/shortcuts", "run", s.Shortcut, "--input-path", path)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("shortcut %q failed: %w", s.Shortcut, err)
	}
	return nil
}
