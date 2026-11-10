"""Voice-over: one mp3 + word timings per line, with edge-tts (Microsoft neural voices).
   python tools/vo.py jobs.json      jobs: [{"file": "public/vo/x.mp3", "text": "...", "voice": "...", "rate": "+0%"}]
Writes x.mp3 and x.json ([{"w": word, "s": start_s, "e": end_s}]). Called by tools/timeline.mjs for lines whose text changed."""
import asyncio, json, sys
import edge_tts


async def one(job):
    c = edge_tts.Communicate(job["text"], job["voice"], rate=job.get("rate", "+0%"), boundary="WordBoundary")
    words = []
    with open(job["file"], "wb") as f:
        async for chunk in c.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                s = chunk["offset"] / 1e7
                words.append({"w": chunk["text"], "s": round(s, 3), "e": round(s + chunk["duration"] / 1e7, 3)})
    with open(job["file"][:-4] + ".json", "w", encoding="utf-8") as f:
        json.dump(words, f)
    print("vo:", job["file"], f"{words[-1]['e'] if words else 0:.1f}s")


async def main():
    for job in json.load(open(sys.argv[1], encoding="utf-8")):
        for attempt in range(3):
            try:
                await one(job)
                break
            except Exception as e:  # the service drops connections now and then
                print("retry", job["file"], e)
                await asyncio.sleep(3)
        else:
            sys.exit(f"edge-tts failed for {job['file']}")


asyncio.run(main())
