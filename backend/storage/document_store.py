from __future__ import annotations

import logging
import os
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

from config import settings

logger = logging.getLogger(__name__)


@dataclass
class FileInfo:
    filename: str
    path: str
    size: int
    project_id: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    content_type: str = "application/octet-stream"


class DocumentStore:
    def __init__(self, upload_dir: Optional[str] = None, use_s3: bool = False):
        self.upload_dir = upload_dir or settings.UPLOAD_DIR
        self.use_s3 = use_s3 and bool(getattr(settings, "AWS_BUCKET_NAME", ""))
        self._s3_client = None

        os.makedirs(self.upload_dir, exist_ok=True)

        if self.use_s3:
            self._init_s3()

    def _init_s3(self):
        try:
            import boto3

            self._s3_client = boto3.client(
                "s3",
                aws_access_key_id=getattr(settings, "AWS_ACCESS_KEY_ID", ""),
                aws_secret_access_key=getattr(settings, "AWS_SECRET_ACCESS_KEY", ""),
                region_name=getattr(settings, "AWS_REGION", ""),
            )
            logger.info("S3 client initialized")
        except Exception as exc:
            logger.warning("S3 initialization failed: %s", exc)
            self.use_s3 = False

    async def save_file(
        self,
        file_content: bytes,
        filename: str,
        project_id: str,
        content_type: str = "application/octet-stream",
    ) -> FileInfo:
        safe_filename = self._sanitize_filename(filename)
        project_dir = os.path.join(self.upload_dir, project_id)
        os.makedirs(project_dir, exist_ok=True)

        file_id = str(uuid.uuid4())
        _, ext = os.path.splitext(safe_filename)
        stored_filename = f"{file_id}{ext}"
        file_path = os.path.join(project_dir, stored_filename)

        with open(file_path, "wb") as file_handle:
            file_handle.write(file_content)

        file_info = FileInfo(
            id=file_id,
            filename=safe_filename,
            path=file_path,
            size=len(file_content),
            project_id=project_id,
            content_type=content_type,
        )

        if self.use_s3:
            await self._upload_to_s3(file_content, file_path, project_id)

        logger.info("Saved file %s to %s", safe_filename, file_path)
        return file_info

    async def get_file(self, file_path: str) -> bytes:
        if self.use_s3:
            return await self._download_from_s3(file_path)

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        with open(file_path, "rb") as file_handle:
            return file_handle.read()

    async def list_files(self, project_id: str) -> List[FileInfo]:
        project_dir = os.path.join(self.upload_dir, project_id)
        if not os.path.exists(project_dir):
            return []

        files = []
        for filename in os.listdir(project_dir):
            file_path = os.path.join(project_dir, filename)
            if os.path.isfile(file_path):
                stat = os.stat(file_path)
                files.append(
                    FileInfo(
                        filename=filename,
                        path=file_path,
                        size=stat.st_size,
                        project_id=project_id,
                        created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    )
                )
        return files

    async def delete_file(self, file_path: str) -> bool:
        try:
            real_file = os.path.realpath(file_path)
            real_upload = os.path.realpath(self.upload_dir)
            if not real_file.startswith(real_upload + os.sep):
                logger.warning("Blocked path-traversal delete attempt: %s", file_path)
                return False

            if os.path.exists(real_file):
                os.remove(real_file)
                logger.info("Deleted file: %s", real_file)
                return True
            return False
        except Exception as exc:
            logger.error("Error deleting file %s: %s", file_path, exc)
            return False

    async def _upload_to_s3(self, content: bytes, key: str, project_id: str):
        try:
            s3_key = f"{project_id}/{os.path.basename(key)}"
            self._s3_client.put_object(
                Bucket=getattr(settings, "AWS_BUCKET_NAME", ""),
                Key=s3_key,
                Body=content,
            )
        except Exception as exc:
            logger.error("S3 upload failed: %s", exc)

    async def _download_from_s3(self, key: str) -> bytes:
        try:
            response = self._s3_client.get_object(
                Bucket=getattr(settings, "AWS_BUCKET_NAME", ""),
                Key=key,
            )
            return response["Body"].read()
        except Exception as exc:
            logger.error("S3 download failed: %s", exc)
            raise

    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        filename = unicodedata.normalize("NFKD", filename)
        basename = os.path.basename(filename)
        safe_chars = []
        for char in basename:
            if char.isalnum() or char in "_-":
                safe_chars.append(char)
            elif char == ".":
                if safe_chars and safe_chars[-1] != ".":
                    safe_chars.append(char)
        safe = "".join(safe_chars).strip(".")
        if len(safe) > 255:
            name, _, ext = safe.rpartition(".")
            safe = name[: 250 - len(ext)] + "." + ext if ext else safe[:255]
        stem = safe.split(".")[0].upper()
        if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$", stem):
            safe = f"file_{safe}"
        return safe or "unnamed_file"
