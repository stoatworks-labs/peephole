# Peephole

A camera or capture card, full screen, in a browser tab.

## Using it

Open <https://peephole.stoatworks-labs.com>, press **Start**, and allow the
camera when the browser asks. Then **Full screen**.

That is the whole tool. Everything below is detail you only need when something
is not as you expect.

### The bar along the bottom

| | |
| --- | --- |
| **Device** | Every video input the browser can see — built-in cameras, USB cameras, and HDMI capture cards, which appear here like any other camera. |
| **Mode** | The resolution to ask the device for. *Whatever the device offers* lets the browser choose. |
| **Fit / Fill** | *Fit* shows the whole picture with bars where the shapes differ. *Fill* crops it to the screen. |
| **Mirror** | Flips left to right — what you want when someone is using it to look at themselves, and not what you want for reading anything on screen. |
| **0° / 90° / …** | Quarter turns, for a camera mounted on its side or a portrait screen. |
| **Readout** | What the device actually settled on, on the right. |

Keyboard: **F** full screen, **M** mirror, **R** rotate, **C** fit or fill.

In full screen the bar and the mouse pointer fade after a couple of seconds of
stillness, and come back as soon as you move.

### Why the picture might be soft

This is the one that catches people, and it is not the page's doing: a capture
card advertises a list of modes and the browser picks a conservative one, so a
card carrying 1080p can open at 640 × 480 and look exactly like a bad cable.

Set **Mode** to the resolution you expect and watch the readout. If it says what
you asked for, that is what you are getting. If it reports something smaller,
the readout says so — *asked for 1920 × 1080* — which means the device refused,
usually because the source is not really running at that mode.

### The screen going dark

Where the browser supports it, Peephole holds a wake lock while a picture is up,
so the screen does not dim or sleep. Firefox, and Safari before 16.4, have no
such lock — the readout says so, and the machine's own energy settings are then
the only thing keeping the screen on.

### Things it says, and what to do about them

| It says | What is happening |
| --- | --- |
| *The browser blocked access to the camera.* | The site is not allowed to use the camera. The padlock in the address bar is where to change it, then press Start again. |
| *The device is there but would not open.* | Something else has it — OBS, Teams, Zoom, another tab of this page. A camera can usually only be opened once. |
| *The device stopped.* | It was unplugged, or another application took it. Press Start. |
| *That device is no longer there.* | The remembered device is gone; pick another from the list. |
| *Cameras are only available on a secure page.* | You are on an `http://` address. Use the hosted page, or `localhost`. |

### Privacy

The picture goes from the device to the screen inside your browser. Nothing is
recorded, nothing is uploaded, there is no account, and no server sees anything
— the page is static files. Closing the tab ends it.

The only thing kept is your choice of device, mode and view, stored in this
browser so the page comes back the way you left it.

### What it deliberately does not do

No recording, no snapshots, no streaming out, and no audio. For production use
[OBS](https://obsproject.com); to put a capture device on the network, see
[frame-ferret](https://stoatworks-labs.com/software/frame-ferret/).
