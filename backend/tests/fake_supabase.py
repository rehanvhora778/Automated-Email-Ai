"""A tiny in-memory stand-in for the Supabase client, for tests.

The app talks to Supabase through a small, repetitive slice of the PostgREST
builder — `from_(table).select(...).eq(...).execute()` and friends — so a fake
that understands just that slice lets the OAuth state machine be tested for
real: the rows that get written, the rows that get consumed, and the order it
all happens in. The alternative, mocking each call site, would assert that the
code calls what we expected rather than that the flow behaves correctly.

Only the operations the app actually performs are implemented. Anything else
raises, loudly, rather than quietly returning an empty result and turning a
test into a false pass.
"""


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, store, table):
        self._store = store
        self._table = table
        self._op = None
        self._payload = None
        self._filters = []      # (column, value) pairs, all ANDed
        self._lt = None         # (column, value)
        self._columns = None
        self._order = None
        self._limit = None

    # --- operations ---
    def select(self, *columns):
        self._op = "select"
        self._columns = [c.strip() for part in columns for c in str(part).split(",")]
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def upsert(self, payload):
        self._op = "upsert"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    # --- filters / modifiers ---
    def eq(self, column, value):
        self._filters.append((column, value))
        return self

    def lt(self, column, value):
        self._lt = (column, value)
        return self

    def order(self, column, desc=False):
        self._order = (column, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def maybe_single(self):
        self._limit = 1
        return self

    # --- execution ---
    def _matches(self, row):
        for column, value in self._filters:
            if row.get(column) != value:
                return False
        if self._lt:
            column, value = self._lt
            if not (row.get(column) is not None and str(row[column]) < str(value)):
                return False
        return True

    def execute(self):
        rows = self._store.setdefault(self._table, [])

        if self._op == "select":
            found = [dict(r) for r in rows if self._matches(r)]
            if self._order:
                column, desc = self._order
                found.sort(key=lambda r: str(r.get(column) or ""), reverse=desc)
            if self._limit is not None:
                found = found[: self._limit]
            if self._columns and self._columns != ["*"]:
                found = [{c: r.get(c) for c in self._columns} for r in found]
            return _Result(found)

        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            created = [dict(i) for i in items]
            rows.extend(created)
            return _Result(created)

        if self._op == "upsert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            written = []
            for item in items:
                key = item.get("id") or item.get("state")
                existing = next(
                    (r for r in rows if (r.get("id") or r.get("state")) == key), None
                )
                if existing is not None:
                    existing.update(item)
                    written.append(dict(existing))
                else:
                    rows.append(dict(item))
                    written.append(dict(item))
            return _Result(written)

        if self._op == "update":
            touched = []
            for row in rows:
                if self._matches(row):
                    row.update(self._payload)
                    touched.append(dict(row))
            return _Result(touched)

        if self._op == "delete":
            removed = [dict(r) for r in rows if self._matches(r)]
            self._store[self._table] = [r for r in rows if not self._matches(r)]
            return _Result(removed)

        raise AssertionError(f"FakeSupabase: unsupported operation on {self._table}")


class FakeSupabase:
    """Holds every table as a list of dicts. `store` is open for assertions."""

    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def from_(self, table):
        return _Query(self.store, table)

    # The app uses both spellings of the same thing.
    def table(self, name):
        return self.from_(name)

    # --- test helpers ---
    def rows(self, table):
        return self.store.setdefault(table, [])

    def seed(self, table, *rows):
        self.store.setdefault(table, []).extend(dict(r) for r in rows)
