"""
Astra OS — Google Contacts (People API) Integration
=====================================================
Async wrapper around the Google People API v1.

Capabilities:
  - Search contacts by name or email
  - Get contact details (phone, email, org, title)
  - List frequently contacted people
  - Get a specific contact by resource name
  - List all contacts with pagination

Scopes used:
  contacts.readonly — read contact data (names, emails, phones, orgs)
"""

import asyncio
import os
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build


# Combined scopes — shared token file with Gmail/Calendar/Drive/Tasks
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

# Fields to request from People API
PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations,photos,biographies,urls"


class Contact:
    """Parsed representation of a Google Contact."""

    __slots__ = (
        "resource_name", "name", "emails", "phones",
        "organization", "title", "photo_url", "bio",
    )

    def __init__(self, resource_name="", name="", emails=None, phones=None,
                 organization="", title="", photo_url="", bio=""):
        self.resource_name = resource_name
        self.name          = name
        self.emails        = emails or []
        self.phones        = phones or []
        self.organization  = organization
        self.title         = title
        self.photo_url     = photo_url
        self.bio           = bio

    @property
    def primary_email(self) -> str:
        return self.emails[0] if self.emails else ""

    @property
    def primary_phone(self) -> str:
        return self.phones[0] if self.phones else ""

    def to_dict(self) -> dict:
        return {
            "resource_name": self.resource_name,
            "name":          self.name,
            "emails":        self.emails,
            "phones":        self.phones,
            "organization":  self.organization,
            "title":         self.title,
            "photo_url":     self.photo_url,
            "primary_email": self.primary_email,
            "primary_phone": self.primary_phone,
        }


class ContactsClient:
    """Async Google People API client for contact management."""

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
        return build("people", "v1", credentials=creds, cache_discovery=False)

    # ── Search ─────────────────────────────────────────────────────────────

    async def search_contacts(self, query: str, max_results: int = 10) -> list[Contact]:
        """
        Search contacts by name, email, or phone number.

        Args:
            query: Search string (e.g. "John", "john@example.com", "+1555")
            max_results: Max results to return

        Returns:
            List of matching Contact objects
        """
        def _search():
            service = self._build_service()
            result = service.people().searchContacts(
                query=query,
                pageSize=max_results,
                readMask=PERSON_FIELDS,
            ).execute()
            return result.get("results", [])

        try:
            raw = await asyncio.to_thread(_search)
            contacts = []
            for item in raw:
                person = item.get("person", {})
                if person:
                    contacts.append(self._parse_person(person))
            return contacts
        except Exception as e:
            print(f"[Contacts] search failed: {e}")
            return []

    async def list_contacts(self, max_results: int = 100) -> list[Contact]:
        """
        List all contacts, ordered by last updated.

        Args:
            max_results: Max contacts to return (up to 1000)

        Returns:
            List of Contact objects
        """
        def _fetch():
            service = self._build_service()
            result = service.people().connections().list(
                resourceName="people/me",
                pageSize=min(max_results, 1000),
                personFields=PERSON_FIELDS,
                sortOrder="LAST_MODIFIED_DESCENDING",
            ).execute()
            return result.get("connections", [])

        try:
            raw = await asyncio.to_thread(_fetch)
            return [self._parse_person(p) for p in raw if p]
        except Exception as e:
            print(f"[Contacts] list contacts failed: {e}")
            return []

    async def get_contact(self, resource_name: str) -> Optional[Contact]:
        """
        Get a specific contact by resource name.

        Args:
            resource_name: e.g. "people/c12345678"

        Returns:
            Contact object or None
        """
        def _fetch():
            service = self._build_service()
            return service.people().get(
                resourceName=resource_name,
                personFields=PERSON_FIELDS,
            ).execute()

        try:
            raw = await asyncio.to_thread(_fetch)
            return self._parse_person(raw)
        except Exception as e:
            print(f"[Contacts] get contact failed: {e}")
            return None

    async def get_contact_by_email(self, email: str) -> Optional[Contact]:
        """
        Find a contact by email address.

        Args:
            email: Email address to look up

        Returns:
            Contact object or None if not found
        """
        results = await self.search_contacts(email, max_results=5)
        email_lower = email.lower()
        for contact in results:
            if email_lower in [e.lower() for e in contact.emails]:
                return contact
        # Return first result if any (might be partial match)
        return results[0] if results else None

    async def get_other_contacts(self, max_results: int = 50) -> list[Contact]:
        """
        List 'Other contacts' — people you've interacted with
        but haven't explicitly added to contacts.
        These often include investors, partners, customers.

        Returns:
            List of Contact objects from the "Other contacts" category
        """
        def _fetch():
            service = self._build_service()
            result = service.otherContacts().list(
                pageSize=min(max_results, 1000),
                readMask="names,emailAddresses,phoneNumbers",
            ).execute()
            return result.get("otherContacts", [])

        try:
            raw = await asyncio.to_thread(_fetch)
            return [self._parse_person(p) for p in raw if p]
        except Exception as e:
            print(f"[Contacts] list other contacts failed: {e}")
            return []

    # ── Parsing ───────────────────────────────────────────────────────────

    def _parse_person(self, person: dict) -> Contact:
        # Name
        names = person.get("names", [])
        name = names[0].get("displayName", "") if names else ""

        # Emails
        emails = [
            e.get("value", "")
            for e in person.get("emailAddresses", [])
            if e.get("value")
        ]

        # Phones
        phones = [
            p.get("value", "")
            for p in person.get("phoneNumbers", [])
            if p.get("value")
        ]

        # Organization & title
        orgs = person.get("organizations", [])
        organization = orgs[0].get("name", "") if orgs else ""
        title = orgs[0].get("title", "") if orgs else ""

        # Photo
        photos = person.get("photos", [])
        photo_url = photos[0].get("url", "") if photos else ""

        # Bio
        bios = person.get("biographies", [])
        bio = bios[0].get("value", "") if bios else ""

        return Contact(
            resource_name=person.get("resourceName", ""),
            name=name,
            emails=emails,
            phones=phones,
            organization=organization,
            title=title,
            photo_url=photo_url,
            bio=bio,
        )
