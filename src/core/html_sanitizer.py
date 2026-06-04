import bleach
from bleach.css_sanitizer import CSSSanitizer

ALLOWED_TAGS = [
    "p",
    "strong",
    "em",
    "u",
    "code",
    "pre",
    "mark",
    "br",
    "blockquote",
    "span",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
]

ALLOWED_ATTRS = {
    "span": ["style"],
}

CSS_SANITIZER = CSSSanitizer(
    allowed_css_properties=[
        "color",
    ]
)

def sanitize_html(html: str) -> str:
    if not html:
        return ""

    if not isinstance(html, str):
        html = str(html)

    cleaned = bleach.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        css_sanitizer=CSS_SANITIZER,
        strip=True,
    )

    return cleaned.strip()