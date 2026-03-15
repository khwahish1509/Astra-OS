"""
Astra OS — Google Tasks Integration
=====================================
Async wrapper around the Google Tasks API v1.

Capabilities:
  - List all task lists
  - List tasks in a task list (with filtering)
  - Create new tasks
  - Complete / update tasks
  - Delete tasks
  - Move tasks (reorder)

Scopes used:
  tasks — full read/write access to Google Tasks
"""

import asyncio
import os
from datetime import datetime, timezone
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build


# Combined scopes — shared token file with Gmail/Calendar/Drive
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/tasks",
]


class TaskItem:
    """Parsed representation of a Google Task."""

    __slots__ = (
        "task_id", "title", "notes", "status", "due",
        "completed", "parent", "position", "updated", "task_list_id",
    )

    def __init__(self, task_id, title, notes="", status="needsAction",
                 due="", completed="", parent="", position="",
                 updated="", task_list_id=""):
        self.task_id      = task_id
        self.title        = title
        self.notes        = notes
        self.status       = status      # "needsAction" or "completed"
        self.due          = due         # RFC 3339 date string
        self.completed    = completed   # RFC 3339 timestamp
        self.parent       = parent      # parent task ID (for subtasks)
        self.position      = position
        self.updated      = updated
        self.task_list_id = task_list_id

    @property
    def is_completed(self) -> bool:
        return self.status == "completed"

    def to_dict(self) -> dict:
        return {
            "task_id":      self.task_id,
            "title":        self.title,
            "notes":        self.notes,
            "status":       self.status,
            "is_completed": self.is_completed,
            "due":          self.due,
            "completed":    self.completed,
            "task_list_id": self.task_list_id,
        }


class TaskList:
    """Parsed representation of a Google Task List."""

    __slots__ = ("list_id", "title", "updated")

    def __init__(self, list_id, title, updated=""):
        self.list_id = list_id
        self.title   = title
        self.updated = updated

    def to_dict(self) -> dict:
        return {
            "list_id": self.list_id,
            "title":   self.title,
            "updated": self.updated,
        }


class TasksClient:
    """Async Google Tasks API client."""

    def __init__(self, credentials_path: str, token_path: str):
        self._credentials_path = credentials_path
        self._token_path       = token_path

    def _get_credentials(self) -> Credentials:
        creds = None
        if os.path.exists(self._token_path):
            creds = Credentials.from_authorized_user_file(self._token_path, SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(self._credentials_path, SCOPES)
                creds = flow.run_local_server(port=0)
            with open(self._token_path, "w") as f:
                f.write(creds.to_json())
        return creds

    def _build_service(self):
        creds = self._get_credentials()
        return build("tasks", "v1", credentials=creds, cache_discovery=False)

    # ── Task Lists ─────────────────────────────────────────────────────────

    async def get_task_lists(self, max_results: int = 20) -> list[TaskList]:
        """List all task lists for the user."""
        def _fetch():
            service = self._build_service()
            result = service.tasklists().list(maxResults=max_results).execute()
            return result.get("items", [])

        try:
            raw = await asyncio.to_thread(_fetch)
            return [
                TaskList(
                    list_id=item.get("id", ""),
                    title=item.get("title", ""),
                    updated=item.get("updated", ""),
                )
                for item in raw
            ]
        except Exception as e:
            print(f"[Tasks] list task lists failed: {e}")
            return []

    # ── Tasks ──────────────────────────────────────────────────────────────

    async def get_tasks(
        self,
        task_list_id: str = "@default",
        show_completed: bool = False,
        max_results: int = 50,
    ) -> list[TaskItem]:
        """
        List tasks in a task list.

        Args:
            task_list_id: Task list ID (default: primary list "@default")
            show_completed: If True, include completed tasks
            max_results: Max tasks to return
        """
        def _fetch():
            service = self._build_service()
            result = service.tasks().list(
                tasklist=task_list_id,
                maxResults=max_results,
                showCompleted=show_completed,
                showHidden=show_completed,
            ).execute()
            return result.get("items", [])

        try:
            raw = await asyncio.to_thread(_fetch)
            return [self._parse_task(item, task_list_id) for item in raw if item.get("title")]
        except Exception as e:
            print(f"[Tasks] list tasks failed: {e}")
            return []

    async def create_task(
        self,
        title: str,
        notes: str = "",
        due: str = "",
        task_list_id: str = "@default",
    ) -> Optional[TaskItem]:
        """
        Create a new task.

        Args:
            title: Task title
            notes: Optional description/notes
            due: Optional due date (RFC 3339, e.g. "2025-03-20T00:00:00Z")
            task_list_id: Which task list to add to (default: primary)

        Returns:
            Created TaskItem or None on failure
        """
        body = {"title": title}
        if notes:
            body["notes"] = notes
        if due:
            body["due"] = due

        def _create():
            service = self._build_service()
            return service.tasks().insert(
                tasklist=task_list_id, body=body
            ).execute()

        try:
            result = await asyncio.to_thread(_create)
            print(f"[Tasks] Created: {title}")
            return self._parse_task(result, task_list_id)
        except Exception as e:
            print(f"[Tasks] create task failed: {e}")
            return None

    async def complete_task(
        self,
        task_id: str,
        task_list_id: str = "@default",
    ) -> bool:
        """Mark a task as completed."""
        def _update():
            service = self._build_service()
            service.tasks().patch(
                tasklist=task_list_id,
                task=task_id,
                body={"status": "completed"},
            ).execute()

        try:
            await asyncio.to_thread(_update)
            print(f"[Tasks] Completed: {task_id}")
            return True
        except Exception as e:
            print(f"[Tasks] complete task failed: {e}")
            return False

    async def update_task(
        self,
        task_id: str,
        task_list_id: str = "@default",
        title: str = "",
        notes: str = "",
        due: str = "",
    ) -> Optional[TaskItem]:
        """Update an existing task's title, notes, or due date."""
        body = {}
        if title:
            body["title"] = title
        if notes:
            body["notes"] = notes
        if due:
            body["due"] = due

        if not body:
            return None

        def _update():
            service = self._build_service()
            return service.tasks().patch(
                tasklist=task_list_id,
                task=task_id,
                body=body,
            ).execute()

        try:
            result = await asyncio.to_thread(_update)
            return self._parse_task(result, task_list_id)
        except Exception as e:
            print(f"[Tasks] update task failed: {e}")
            return None

    async def delete_task(
        self,
        task_id: str,
        task_list_id: str = "@default",
    ) -> bool:
        """Delete a task permanently."""
        def _delete():
            service = self._build_service()
            service.tasks().delete(
                tasklist=task_list_id,
                task=task_id,
            ).execute()

        try:
            await asyncio.to_thread(_delete)
            print(f"[Tasks] Deleted: {task_id}")
            return True
        except Exception as e:
            print(f"[Tasks] delete task failed: {e}")
            return False

    # ── Parsing ───────────────────────────────────────────────────────────

    def _parse_task(self, item: dict, task_list_id: str = "") -> TaskItem:
        return TaskItem(
            task_id=item.get("id", ""),
            title=item.get("title", ""),
            notes=item.get("notes", ""),
            status=item.get("status", "needsAction"),
            due=item.get("due", ""),
            completed=item.get("completed", ""),
            parent=item.get("parent", ""),
            position=item.get("position", ""),
            updated=item.get("updated", ""),
            task_list_id=task_list_id,
        )
