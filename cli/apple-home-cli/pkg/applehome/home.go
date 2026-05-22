package applehome

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

func DefaultHomeDBPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "HomeKit", "core.sqlite")
}

type HomeDB struct {
	Path string
}

func NewHomeDB(path string) HomeDB {
	if path == "" {
		path = DefaultHomeDBPath()
	}
	return HomeDB{Path: path}
}

func (h HomeDB) open() (*sql.DB, error) {
	if _, err := os.Stat(h.Path); err != nil {
		return nil, fmt.Errorf("home database not found: %s", h.Path)
	}
	return sql.Open("sqlite", "file:"+h.Path+"?mode=ro")
}

type Home struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	ModelID string `json:"model_id"`
}

type Room struct {
	ID      int    `json:"id"`
	Home    string `json:"home"`
	Name    string `json:"name"`
	ModelID string `json:"model_id"`
}

type Scene struct {
	ID      int    `json:"id"`
	Home    string `json:"home"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	ModelID string `json:"model_id"`
}

type Device struct {
	ID           int      `json:"id"`
	Home         string   `json:"home"`
	Room         string   `json:"room"`
	Name         string   `json:"name"`
	Manufacturer string   `json:"manufacturer"`
	Model        string   `json:"model"`
	Protocol     string   `json:"protocol"`
	ModelID      string   `json:"model_id"`
	UniqueID     string   `json:"unique_id"`
	Services     []string `json:"services,omitempty"`
}

func scanString(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

func (h HomeDB) Homes() ([]Home, error) {
	db, err := h.open()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`select Z_PK, coalesce(ZNAME,''), lower(hex(ZMODELID)) from ZMKFHOME order by ZNAME`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Home
	for rows.Next() {
		var x Home
		if err := rows.Scan(&x.ID, &x.Name, &x.ModelID); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (h HomeDB) Rooms() ([]Room, error) {
	db, err := h.open()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`
		select r.Z_PK, coalesce(h.ZNAME,''), coalesce(r.ZNAME,''), lower(hex(r.ZMODELID))
		from ZMKFROOM r left join ZMKFHOME h on r.ZHOME=h.Z_PK
		order by h.ZNAME, r.ZNAME`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Room
	for rows.Next() {
		var x Room
		if err := rows.Scan(&x.ID, &x.Home, &x.Name, &x.ModelID); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (h HomeDB) Scenes() ([]Scene, error) {
	db, err := h.open()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`
		select s.Z_PK, coalesce(h.ZNAME,''), coalesce(s.ZNAME,''), coalesce(s.ZTYPE,''), lower(hex(s.ZMODELID))
		from ZMKFACTIONSET s left join ZMKFHOME h on s.ZHOME=h.Z_PK
		order by h.ZNAME, s.ZNAME`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Scene
	for rows.Next() {
		var x Scene
		if err := rows.Scan(&x.ID, &x.Home, &x.Name, &x.Type, &x.ModelID); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (h HomeDB) Devices(verbose bool) ([]Device, error) {
	db, err := h.open()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`
		select a.Z_PK,
		       coalesce(h.ZNAME,''),
		       coalesce(r.ZNAME,''),
		       coalesce(a.ZCONFIGUREDNAME, a.ZPROVIDEDNAME, a.ZMODEL, a.ZINITIALMODEL, 'Accessory ' || a.Z_PK),
		       coalesce(a.ZMANUFACTURER, a.ZINITIALMANUFACTURER, ''),
		       coalesce(a.ZMODEL, a.ZINITIALMODEL, ''),
		       case a.ZCOMMUNICATIONPROTOCOL when 1 then 'hap' when 2 then 'matter' else coalesce(cast(a.ZCOMMUNICATIONPROTOCOL as text), '') end,
		       lower(hex(a.ZMODELID)),
		       coalesce(a.ZUNIQUEIDENTIFIER, '')
		from ZMKFACCESSORY a
		left join ZMKFROOM r on a.ZROOM=r.Z_PK
		left join ZMKFHOME h on a.ZHOME=h.Z_PK
		order by r.ZNAME, 4`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Device
	for rows.Next() {
		var x Device
		if err := rows.Scan(&x.ID, &x.Home, &x.Room, &x.Name, &x.Manufacturer, &x.Model, &x.Protocol, &x.ModelID, &x.UniqueID); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if verbose {
		services, err := h.services(db)
		if err != nil {
			return nil, err
		}
		for i := range out {
			out[i].Services = services[out[i].ID]
		}
	}
	return out, nil
}

func (h HomeDB) services(db *sql.DB) (map[int][]string, error) {
	rows, err := db.Query(`
		select ZACCESSORY, coalesce(ZNAME, ZPROVIDEDNAME, ZEXPECTEDCONFIGUREDNAME, '')
		from ZMKFSERVICE where ZACCESSORY is not null`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sets := map[int]map[string]bool{}
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if sets[id] == nil {
			sets[id] = map[string]bool{}
		}
		sets[id][name] = true
	}
	out := map[int][]string{}
	for id, set := range sets {
		for name := range set {
			out[id] = append(out[id], name)
		}
	}
	return out, rows.Err()
}

func Normalize(s string) string {
	s = strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(s, "_", " "), "-", " "))
	return strings.Join(strings.Fields(s), " ")
}

func (h HomeDB) FindDevice(query string) (Device, []Device, error) {
	devices, err := h.Devices(true)
	if err != nil {
		return Device{}, nil, err
	}
	q := Normalize(query)
	var exact, contains []Device
	for _, d := range devices {
		name := Normalize(d.Name)
		room := Normalize(d.Room)
		if name == q {
			exact = append(exact, d)
		}
		if strings.Contains(name, q) || strings.Contains(room, q) {
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
		return Device{}, contains, fmt.Errorf("multiple accessories match %q", query)
	}
	return Device{}, nil, fmt.Errorf("no accessory matches %q", query)
}
