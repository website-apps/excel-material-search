"""Read final Responses API messages without exposing reasoning output."""


def final_response_text(payload: dict) -> str:
    if payload.get("status") == "incomplete":
        return ""
    output = payload.get("output")
    if isinstance(output, list) and output:
        return "\n".join(
            part["text"]
            for item in output
            if item.get("type") == "message" and item.get("phase") != "analysis"
            for part in item.get("content", [])
            if part.get("type") == "output_text" and isinstance(part.get("text"), str)
        ).strip()
    text = payload.get("output_text")
    return text.strip() if isinstance(text, str) else ""
