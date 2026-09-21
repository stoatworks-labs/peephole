#!/usr/bin/env python3
"""Register peephole in the three tables a fleet project has to be in.

Missing any one of them fails differently and quietly:
  * projects.json  — gen-downloads prints nothing and exits 0
  * sync-about.py TARGETS — "unknown repo(s)"
  * attributions/names.json — the generated issue forms call it by its slug
"""
import json
import re
import sys

SITE = "/Users/allansargeant/Projects/infrastructure/stoatworks-website/.claude/worktrees/peephole"
BACK = "/Users/allansargeant/Projects/infrastructure/stoatworks-backend/.claude/worktrees/peephole"

ENTRY = {
    "slug": "peephole",
    "name": "Peephole",
    "hook": "A camera or capture card, full screen",
    "category": ["av"],
    "kind": "browserapp",
    "status": "building",
    "public": True,
    "repo": "https://github.com/stoatworks-labs/peephole",
    "lang": "TypeScript",
    "summary": (
        "Opens a webcam or an HDMI capture card full screen in a browser tab, with the one thing a bare "
        "getUserMedia page gets wrong: a capture card advertises a list of modes and the browser picks a "
        "conservative one, so a card carrying 1080p opens at 640 × 480 and simply looks soft. This asks the "
        "device what it can do, offers those modes, and reports what the stream actually settled on — saying "
        "so when that is smaller than what was asked for. Mirror, quarter-turn rotation, fit or fill, a screen "
        "that stays awake while a picture is up, and a bar that fades with the cursor in full screen. Nothing "
        "is recorded and nothing leaves the browser."
    ),
    "tags": ["Camera", "Capture card", "Confidence monitor", "Full screen", "Browser"],
    "thumb": "/thumbs/peephole.png",
    "demo": "https://peephole.stoatworks-labs.com",
    "license": "MIT",
    "guide": True,
    "detail": {
        "overview": [
            "You have a camera or an HDMI capture card plugged in and you want to look at it — on a second "
            "screen, at the back of the room, on the laptop beside the desk. OBS will do it, after a scene, a "
            "source, a preview, a projector output and a window to hide. This is that job with nothing in "
            "front of it: open the page, press Start, press Full screen.",
            "The reason it is not a ten-line page is the capture card. A UVC device advertises a mode list and "
            "the browser chooses conservatively from it, so a 1080p card can open at VGA with nothing on "
            "screen to say why the picture is soft — it reads as a bad cable or a tired card. Peephole asks "
            "the device for its capabilities, offers what it really supports, and puts what the stream "
            "actually settled on in the corner. Ask for 1920 × 1080 and get 640 × 480 and it says so.",
            "The rest is the difference between a demo and something you would leave running. The screen is "
            "held awake while a picture is up, and the lock is re-taken when you come back to the tab, because "
            "browsers drop it whenever the tab is hidden. The device is remembered by name as well as by id, "
            "because ids are rotated whenever the site's camera permission is reset. A stream that ends — card "
            "unplugged, another app taking it — says so rather than leaving a frozen last frame that looks "
            "like a working picture. And getUserMedia's errors are rewritten into what to do about them: "
            "\"something else usually has it: OBS, Teams, Zoom, or another tab of this page\".",
        ],
        "features": [
            "Every video input the browser can see, including HDMI capture cards, which appear like any other camera",
            "Mode picker built from the device's own reported capabilities, falling back to a standard ladder where the browser will not say",
            "A readout of what the stream really settled on, and a warning when it is smaller than what was asked for",
            "Screen wake lock while a picture is up, re-taken when the tab comes back — and an honest note where the browser has none",
            "Device and mode remembered by id and by name, so it survives a permission reset",
            "Mirror, quarter-turn rotation, fit or fill; keyboard F, M, R and C",
            "In full screen the bar and the cursor fade after a couple of seconds of stillness",
            "Static page, no server, no account: the picture never leaves the browser and nothing is recorded",
        ],
        "statusNote": (
            "Working and deployed, and driven end to end in a browser against an injected MediaStream — device "
            "switching, mode changes, mirror, rotation, fit and fill, and the settings surviving a restart. It "
            "has not yet been run against a real camera or a real capture card, which is exactly the part the "
            "mode picker exists for, so treat the capture-card behaviour as unproven until it has."
        ),
    },
}


def add_project() -> None:
    path = f"{SITE}/src/data/projects.json"
    data = json.load(open(path))
    if any(p.get("slug") == "peephole" for p in data["projects"]):
        print("projects.json: already there")
        return
    # The file is NOT sorted — it is roughly the order projects were added,
    # with a few moved by hand. Sorting it here would churn 1,400 lines and
    # bury the one entry that matters, so the new project simply goes last.
    data["projects"].append(ENTRY)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"projects.json: added ({len(data['projects'])} projects)")


def add_about_target() -> None:
    path = f"{BACK}/scripts/sync-about.py"
    text = open(path).read()
    if '"peephole"' in text:
        print("sync-about TARGETS: already there")
        return
    anchor = '    "line-calc":       ("line-calc",       "web", "public"),\n'
    if anchor not in text:
        sys.exit("sync-about.py: could not find the line-calc target to sit beside")
    line = '    "peephole":        ("peephole",        "web", "public"),\n'
    text = text.replace(anchor, anchor + line, 1)
    open(path, "w").write(text)
    print("sync-about TARGETS: added -> " + line.strip())


def add_name() -> None:
    path = f"{BACK}/attributions/names.json"
    data = json.load(open(path))
    if "peephole" in data:
        print("names.json: already there")
        return
    # Same reasoning as projects.json: append rather than re-sort.
    data["peephole"] = "Peephole"
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"names.json: added ({len(data)} names)")


add_project()
add_about_target()
add_name()
