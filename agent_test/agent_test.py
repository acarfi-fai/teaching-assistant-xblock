from importlib.resources import files
import requests

from web_fragments.fragment import Fragment
from xblock.core import XBlock
from xblock.fields import String, Scope
from xblock.utils.studio_editable import StudioEditableXBlockMixin  # needs xblock-utils

import logging
log = logging.getLogger(__name__)


class AgentTestXBlock(StudioEditableXBlockMixin, XBlock):
    """
    XBlock that shows a YouTube player + chat, and forwards chat to FastAPI service.
    """

    # Studio-editable settings (Scope.settings is the key here)
    service_base_url = String(
        display_name="FastAPI Service Base URL",
        help="Example: http://192.168.48.1:5173 (must be reachable from LMS/Workbench)",
        default="http://192.168.48.1:5173",
        scope=Scope.settings,
    )

    youtube_url = String(
        display_name="YouTube URL (unlisted ok)",
        help="Example: https://www.youtube.com/watch?v=loe_WyY96ss",
        default="https://www.youtube.com/watch?v=loe_WyY96ss",
        scope=Scope.settings,
    )

    editable_fields = ("service_base_url", "youtube_url")

    def resource_string(self, path):
        return files(__package__).joinpath(path).read_text(encoding="utf-8")

    def student_view(self, context=None):
        html = self.resource_string("static/html/agent_test.html")
        frag = Fragment(html)

        frag.add_css(self.resource_string("static/css/agent_test.css"))
        frag.add_javascript(self.resource_string("static/js/src/agent_test.js"))

        # Pass settings down to JS
        frag.initialize_js(
            "AgentTestXBlock",
            {
                "service_base_url": self.service_base_url,
                "youtube_url": self.youtube_url,
            },
        )
        return frag

    @XBlock.json_handler
    def chat(self, data, suffix=""):
        log.warning("CHAT HANDLER HIT data=%s", data)
        message = (data.get("message") or "").strip()
        if not message:
            return {"error": "Empty message"}

        payload = {
            "message": message,
            "video_time": float(data.get("video_time") or 0.0),
            "transcript_window_text": data.get("transcript_window_text") or "",
            # optional:
            "youtube_url": data.get("youtube_url") or self.youtube_url,
            "video_id": data.get("video_id") or "",
        }

        url = self.service_base_url.rstrip("/") + "/chat"
        try:
            r = requests.post(url, json=payload, timeout=60)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            return {"error": f"FastAPI request failed: {e}"}

    @staticmethod
    def workbench_scenarios():
        return [
            ("AgentTestXBlock", "<agent_test/>"),
        ]
