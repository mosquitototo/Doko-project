from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import re


UTC = timezone.utc


def default_calendar():
    return {
        "enabled": False,
        "timezone": "UTC",
        "weekdays": [0, 1, 2, 3, 4],
        "work_start": "09:00",
        "work_end": "17:00",
        "month_days": 20,
        "holidays": [],
    }


def _minute(value, allow_midnight=False):
    if allow_midnight and value == "24:00":
        return 1440
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError("Working times must use HH:MM (24:00 is allowed for the end time).")
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def validate_calendar(value):
    if not isinstance(value, dict):
        raise ValueError("SLA calendar must be an object.")
    result = default_calendar()
    if set(value) - set(result):
        raise ValueError("Unknown SLA calendar field.")
    result.update(deepcopy(value))
    if type(result["enabled"]) is not bool:
        raise ValueError("Calendar enabled must be a boolean.")
    try:
        ZoneInfo(result["timezone"])
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise ValueError("Choose a valid IANA timezone.") from None
    days = result["weekdays"]
    if not isinstance(days, list) or not days or len(days) > 7 or any(type(day) is not int or day not in range(7) for day in days):
        raise ValueError("Choose at least one working day (Monday=0, Sunday=6).")
    result["weekdays"] = sorted(set(days))
    if _minute(result["work_start"]) >= _minute(result["work_end"], True):
        raise ValueError("Work end must be after work start on the same day.")
    if type(result["month_days"]) is not int or not 1 <= result["month_days"] <= 31:
        raise ValueError("Working days per SLA month must be an integer between 1 and 31.")
    entries = result["holidays"]
    if not isinstance(entries, list) or len(entries) > 366:
        raise ValueError("Specify at most 366 holidays per customer.")
    cleaned = []
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) - {"date", "annual", "label"}:
            raise ValueError("Each holiday must contain a date, an optional annual flag and an optional label.")
        raw_date = entry.get("date")
        if not isinstance(raw_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date):
            raise ValueError("Holiday dates must use YYYY-MM-DD.")
        try:
            holiday = date.fromisoformat(raw_date)
        except ValueError:
            raise ValueError("Invalid holiday date.") from None
        annual = entry.get("annual", False)
        label = entry.get("label", "")
        if type(annual) is not bool:
            raise ValueError("Repeat every year must be a boolean.")
        if not isinstance(label, str) or len(label) > 100:
            raise ValueError("Holiday labels must contain at most 100 characters.")
        key = (annual, holiday.month, holiday.day, None if annual else holiday.year)
        if key not in seen:
            cleaned.append({"date": raw_date, "annual": annual, "label": label.strip()})
            seen.add(key)
    result["holidays"] = cleaned
    if result["enabled"] and sum(1 for key in seen if key[0]) == 366:
        raise ValueError("The calendar must leave at least one date available for work.")
    return result


class WorkingCalendar:
    def __init__(self, config):
        self.config = validate_calendar(config or {})
        self.enabled = self.config["enabled"]
        self.zone = ZoneInfo(self.config["timezone"])
        self.weekdays = set(self.config["weekdays"])
        self.start_minute = _minute(self.config["work_start"])
        self.end_minute = _minute(self.config["work_end"], True)
        self.dates = set()
        self.annual_dates = set()
        for entry in self.config["holidays"]:
            day = date.fromisoformat(entry["date"])
            if entry["annual"]:
                self.annual_dates.add((day.month, day.day))
            else:
                self.dates.add(day)

    def interval(self, day):
        if day.weekday() not in self.weekdays or day in self.dates or (day.month, day.day) in self.annual_dates:
            return None
        midnight = datetime.combine(day, time.min)
        start = (midnight + timedelta(minutes=self.start_minute)).replace(tzinfo=self.zone)
        end = (midnight + timedelta(minutes=self.end_minute)).replace(tzinfo=self.zone, fold=1)
        if end.astimezone(UTC).astimezone(self.zone).replace(tzinfo=None) != end.replace(tzinfo=None):
            end = end.replace(fold=0)
        start = start.astimezone(UTC)
        end = end.astimezone(UTC)
        return (start, end) if end > start else None

    def contains(self, instant):
        if not self.enabled:
            return True
        point = instant.astimezone(UTC)
        interval = self.interval(point.astimezone(self.zone).date())
        return bool(interval and interval[0] <= point < interval[1])

    def budget_seconds(self, rule):
        value = rule["value"]
        day = (self.end_minute - self.start_minute) * 60 if self.enabled else 86400
        units = {
            "minute": 60,
            "hour": 3600,
            "day": day,
            "week": day * (len(self.weekdays) if self.enabled else 7),
            "month": day * (self.config["month_days"] if self.enabled else 30),
        }
        return value * units[rule["unit"]]

    def deadline(self, start, seconds):
        point = start.astimezone(UTC)
        if not self.enabled or seconds <= 0:
            return point + timedelta(seconds=seconds)
        day = point.astimezone(self.zone).date()
        empty_days = 0
        while True:
            interval = self.interval(day)
            available = max(0, (interval[1] - max(point, interval[0])).total_seconds()) if interval else 0
            if available:
                if seconds <= available:
                    return max(point, interval[0]) + timedelta(seconds=seconds)
                seconds -= available
                empty_days = 0
            else:
                empty_days += 1
                if empty_days > 366 * 2:
                    raise ValueError("The SLA calendar has no available working time in the next two years.")
            day += timedelta(days=1)

    def elapsed(self, start, end):
        start, end = start.astimezone(UTC), end.astimezone(UTC)
        if end <= start:
            return 0.0
        if not self.enabled:
            return (end - start).total_seconds()
        day = start.astimezone(self.zone).date()
        last = end.astimezone(self.zone).date()
        seconds = 0.0
        while day <= last:
            interval = self.interval(day)
            if interval:
                seconds += max(0, (min(end, interval[1]) - max(start, interval[0])).total_seconds())
            day += timedelta(days=1)
        return seconds


def calculate_deadline(start, rule, config):
    calendar = WorkingCalendar(config)
    return calendar.deadline(start, calendar.budget_seconds(rule))


def working_seconds(start, end, config):
    return WorkingCalendar(config).elapsed(start, end)


def is_working_time(instant, config):
    return WorkingCalendar(config).contains(instant)


def build_snapshot(alert):
    customer = alert.customer if alert.customer_id else None
    rule = customer.get_sla_rule(alert.severity) if customer else None
    config = validate_calendar(customer.sla_calendar if customer else {})
    calendar = WorkingCalendar(config)
    seconds = calendar.budget_seconds(rule) if rule else None
    due = calendar.deadline(alert.created_at, seconds) if seconds is not None else None
    return {
        "customer_id": str(alert.customer_id) if alert.customer_id else None,
        "severity": alert.severity,
        "calendar": config,
        "rule": rule,
        "budget_seconds": seconds,
        "due_at": due.isoformat() if due else None,
    }


def alert_snapshot(alert):
    snapshot = alert.sla_snapshot
    if snapshot is not None and snapshot.get("customer_id") == (str(alert.customer_id) if alert.customer_id else None) and snapshot.get("severity") == alert.severity:
        return snapshot
    return build_snapshot(alert)


def snapshot_deadline(snapshot):
    value = snapshot.get("due_at")
    return datetime.fromisoformat(value) if value else None
