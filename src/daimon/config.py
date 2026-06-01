import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY: str | None = os.getenv("GROQ_API_KEY")
MODEL: str = os.getenv("DAIMON_MODEL", "llama-3.3-70b-versatile")
DB_PATH: Path = Path(os.getenv("DAIMON_DB", "daimon.db"))
USER_NAME: str = os.getenv("DAIMON_USER", "Friend")
