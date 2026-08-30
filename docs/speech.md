# Speech: A Universe in Your Browser (3 minutes, ~420 words)

**[Opening — 15s]**

Good morning everyone. Let me start with a question: what happens when a star falls into a black hole? In most games, it just disappears. In the project I built, it gets stretched, heated, swallowed past the event horizon — and time itself slows down for it. This is my project: a real-time N-body gravity sandbox that runs entirely in your browser.

**[What it is — 30s]**

It's called the Planet Physics Simulator. You open a web page, and you get a small universe. You can place stars and planets, throw them with your mouse, deploy a spaceship and fly it yourself. Every object pulls on every other object, using real gravitational physics. Black holes here are not just dark circles — they use a pseudo-Newtonian potential, so they have an innermost stable orbit, an event horizon that actually captures things, and even gravitational time dilation that you can read live on your screen.

**[The hard part: multiplayer physics — 50s]**

Now, the interesting engineering problem. Physics simulation is expensive, and multiplayer needs one consistent world. The naive solution — run physics on every player's computer — breaks the moment two people touch the same planet. My solution is what I call "authoritative server plus client re-simulation". The server runs the true universe at 30 hertz and streams compressed state frames at 12 hertz. Each client keeps a mirror copy of that universe and integrates it locally between frames, so the motion stays buttery smooth at 60 FPS. When the authoritative frame arrives, the client reconciles: small errors blend away, big errors snap into place. And if the server is unreachable? The same engine silently becomes a single-player universe — your world never breaks.

**[More than a toy — 40s]**

I also wanted it to feel alive. Collisions have four different outcomes: merging, bouncing with sparks, tidal disruption, or shattering into debris. Stars actually age — driven by both what they swallow and by time itself — so with time acceleration you can watch a blue giant swell up and collapse into a black hole in under a minute. And following Minecraft's philosophy, your universe is a save file: it auto-saves every thirty seconds, and with one click you can "open it to LAN" — your friend types a room code and jumps into your universe. You become the host; you leave, your world goes with you.

**[Engineering & closing — 45s]**

Under the hood, it's all TypeScript: a leapfrog integrator with adaptive substeps, unit tests for the physics, end-to-end tests that throw malformed packets at the server to make sure one bad message can never crash the universe. The whole thing — front end, physics server, multiplayer — deploys with a single command.

So: real physics, shared universes, and a black hole that bends time — all in a browser tab. Thank you.

---

*Delivery notes: total ≈ 420 words ≈ 3 minutes at a normal pace. Pause briefly after the opening question and after "60 FPS". The phrase "your world never breaks" and the closing line are the emotional beats — slow down there.*
