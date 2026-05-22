package applehome

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"
)

const LevitonBaseURL = "https://my.leviton.com/api"

type LevitonClient struct {
	BaseURL    string
	Email      string
	Password   string
	Token      string
	UserID     string
	HTTPClient *http.Client
	Debug      bool
}

type LevitonDevice struct {
	ID          string         `json:"id"`
	Name        string         `json:"name,omitempty"`
	DeviceName  string         `json:"deviceName,omitempty"`
	Label       string         `json:"label,omitempty"`
	Model       string         `json:"model,omitempty"`
	DeviceModel string         `json:"deviceModel,omitempty"`
	DeviceType  string         `json:"deviceType,omitempty"`
	Power       string         `json:"power,omitempty"`
	Brightness  any            `json:"brightness,omitempty"`
	ResidenceID string         `json:"residenceId,omitempty"`
	Raw         map[string]any `json:"-"`
}

func NewLevitonClient(email, password string, debug bool) *LevitonClient {
	if email == "" {
		email = os.Getenv("MYLEVITON_EMAIL")
	}
	if password == "" {
		password = os.Getenv("MYLEVITON_PASSWORD")
	}
	return &LevitonClient{BaseURL: LevitonBaseURL, Email: email, Password: password, Debug: debug, HTTPClient: &http.Client{Timeout: 15 * time.Second}}
}

func (c *LevitonClient) request(method, path string, payload any, out any) error {
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	url := c.BaseURL + path
	if c.Debug {
		fmt.Fprintf(os.Stderr, "%s %s\n", method, url)
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	if c.Token != "" {
		req.Header.Set("Authorization", c.Token)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("my leviton API %s %s failed: %s: %s", method, path, resp.Status, string(b))
	}
	if out == nil || len(bytes.TrimSpace(b)) == 0 {
		return nil
	}
	return json.Unmarshal(b, out)
}

func (c *LevitonClient) EnsureLogin() error {
	if c.Token != "" && c.UserID != "" {
		return nil
	}
	if c.Email == "" {
		fmt.Fprint(os.Stderr, "My Leviton email: ")
		fmt.Scanln(&c.Email)
	}
	if c.Password == "" {
		fmt.Fprint(os.Stderr, "My Leviton password: ")
		b, err := term.ReadPassword(int(syscall.Stdin))
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return err
		}
		c.Password = string(b)
	}
	var resp struct {
		ID     string `json:"id"`
		UserID string `json:"userId"`
	}
	if err := c.request("POST", "/Person/login?include=user", map[string]string{"email": c.Email, "password": c.Password}, &resp); err != nil {
		return err
	}
	if resp.ID == "" || resp.UserID == "" {
		return fmt.Errorf("unexpected My Leviton login response")
	}
	c.Token = resp.ID
	c.UserID = resp.UserID
	return nil
}

func (c *LevitonClient) Devices() ([]LevitonDevice, error) {
	if err := c.EnsureLogin(); err != nil {
		return nil, err
	}
	var perms []map[string]any
	if err := c.request("GET", "/Person/"+c.UserID+"/residentialPermissions", nil, &perms); err != nil {
		return nil, err
	}
	var all []LevitonDevice
	seenDevices := map[string]bool{}
	for _, p := range perms {
		accountID, _ := p["residentialAccountId"].(string)
		if accountID == "" {
			continue
		}
		var account map[string]any
		if err := c.request("GET", "/ResidentialAccounts/"+accountID, nil, &account); err != nil {
			return nil, err
		}
		var residenceIDs []string
		if id, _ := account["primaryResidenceId"].(string); id != "" {
			residenceIDs = append(residenceIDs, id)
		}
		if id, _ := account["id"].(string); id != "" {
			var residences []map[string]any
			if err := c.request("GET", "/ResidentialAccounts/"+id+"/residences", nil, &residences); err == nil {
				for _, r := range residences {
					if rid, _ := r["id"].(string); rid != "" {
						residenceIDs = append(residenceIDs, rid)
					}
				}
			}
		}
		seenResidences := map[string]bool{}
		for _, rid := range residenceIDs {
			if rid == "" || seenResidences[rid] {
				continue
			}
			seenResidences[rid] = true
			var raw []map[string]any
			if err := c.request("GET", "/Residences/"+rid+"/iotSwitches", nil, &raw); err != nil {
				return nil, err
			}
			for _, m := range raw {
				d := mapToLevitonDevice(m)
				d.ResidenceID = rid
				if d.ID == "" || seenDevices[d.ID] {
					continue
				}
				seenDevices[d.ID] = true
				all = append(all, d)
			}
		}
	}
	return all, nil
}

func mapToLevitonDevice(m map[string]any) LevitonDevice {
	str := func(k string) string { v, _ := m[k].(string); return v }
	return LevitonDevice{ID: str("id"), Name: str("name"), DeviceName: str("deviceName"), Label: str("label"), Model: str("model"), DeviceModel: str("deviceModel"), DeviceType: str("deviceType"), Power: str("power"), Brightness: m["brightness"], Raw: m}
}

func (d LevitonDevice) DisplayName() string {
	for _, s := range []string{d.Name, d.DeviceName, d.Label, d.ID} {
		if s != "" {
			return s
		}
	}
	return ""
}

func (d LevitonDevice) DisplayModel() string {
	for _, s := range []string{d.Model, d.DeviceModel, d.DeviceType} {
		if s != "" {
			return s
		}
	}
	return ""
}

func (c *LevitonClient) FindDevice(query string) (LevitonDevice, []LevitonDevice, error) {
	devices, err := c.Devices()
	if err != nil {
		return LevitonDevice{}, nil, err
	}
	q := Normalize(query)
	matches := func(d LevitonDevice, exact bool) bool {
		for _, s := range []string{d.DisplayName(), d.DeviceName, d.Label, d.ID} {
			n := Normalize(s)
			if exact && n == q {
				return true
			}
			if !exact && strings.Contains(n, q) {
				return true
			}
		}
		return false
	}
	var exact, contains []LevitonDevice
	for _, d := range devices {
		if matches(d, true) {
			exact = append(exact, d)
		}
		if matches(d, false) {
			contains = append(contains, d)
		}
	}
	if len(exact) == 1 {
		return exact[0], nil, nil
	}
	if len(contains) == 1 {
		return contains[0], nil, nil
	}
	if len(contains) > 1 {
		return LevitonDevice{}, contains, fmt.Errorf("multiple My Leviton devices match %q", query)
	}
	return LevitonDevice{}, devices, fmt.Errorf("no My Leviton device matches %q", query)
}

func (c *LevitonClient) SetState(query string, power *string, brightness *int) (map[string]any, error) {
	d, _, err := c.FindDevice(query)
	if err != nil {
		return nil, err
	}
	body := map[string]any{}
	if power != nil {
		body["power"] = strings.ToUpper(*power)
	}
	if brightness != nil {
		if *brightness < 0 || *brightness > 100 {
			return nil, fmt.Errorf("brightness must be 0..100")
		}
		body["brightness"] = *brightness
	}
	if len(body) == 0 {
		return nil, fmt.Errorf("nothing to set")
	}
	var resp map[string]any
	if err := c.request("PUT", "/IotSwitches/"+d.ID, body, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func (c *LevitonClient) GetState(query string) (map[string]any, error) {
	d, _, err := c.FindDevice(query)
	if err != nil {
		return nil, err
	}
	var resp map[string]any
	if err := c.request("GET", "/IotSwitches/"+d.ID, nil, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}
