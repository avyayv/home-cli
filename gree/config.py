from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import tomllib

PACKAGE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = PACKAGE_DIR / "config.toml"
EXAMPLE_CONFIG_PATH = PACKAGE_DIR / "config.example.toml"
DEFAULT_SCAN_WAIT = 2.0


@dataclass(frozen=True)
class GreeConfig:
    preferred_mac: str | None = None
    preferred_ip: str | None = None
    scan_wait: float = DEFAULT_SCAN_WAIT

    def to_dict(self) -> dict[str, object | None]:
        return {
            "preferred_mac": self.preferred_mac,
            "preferred_ip": self.preferred_ip,
            "scan_wait": self.scan_wait,
        }


class ConfigStore:
    def __init__(self, path: Path = CONFIG_PATH):
        self.path = path

    def exists(self) -> bool:
        return self.path.exists()

    def load(self) -> GreeConfig:
        if not self.path.exists():
            return GreeConfig()

        with self.path.open("rb") as fh:
            data = tomllib.load(fh)

        scan_wait = data.get("scan_wait", DEFAULT_SCAN_WAIT)
        preferred_mac = data.get("preferred_mac")
        preferred_ip = data.get("preferred_ip")
        return GreeConfig(
            preferred_mac=preferred_mac or None,
            preferred_ip=preferred_ip or None,
            scan_wait=float(scan_wait),
        )

    def init(self) -> bool:
        if self.path.exists():
            return False
        self.save(GreeConfig())
        return True

    def save(self, config: GreeConfig) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(render_config(config), encoding="utf-8")


def render_config(config: GreeConfig) -> str:
    lines = [
        "# Repo-local defaults for the gree CLI.",
        f"scan_wait = {config.scan_wait}",
    ]
    if config.preferred_mac:
        lines.append(f'preferred_mac = "{config.preferred_mac}"')
    if config.preferred_ip:
        lines.append(f'preferred_ip = "{config.preferred_ip}"')
    return "\n".join(lines) + "\n"
