#!/usr/bin/env python3
"""Fetch a handful of RAVDESS clips without downloading the multi-gigabyte archives.

RAVDESS (Livingstone & Russo, 2018, https://zenodo.org/records/1188976) is licensed
CC BY-NC-SA 4.0. The clips are used here for research only and are NOT stored in this
repository: pass an output directory outside the repo. Individual members are read from
the remote zip files with HTTP range requests.

Usage: python3 -I fetch-ravdess.py <output-dir>
"""
import io
import os
import sys
import urllib.request
import zipfile

BASE = "https://zenodo.org/api/records/1188976/files/{name}/content"


class RangeFile(io.RawIOBase):
    """A read-only, seekable view of a remote file using HTTP range requests."""

    def __init__(self, url):
        self.url = url
        self.pos = 0
        request = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(request) as response:
            self.size = int(response.headers["Content-Length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def read(self, size=-1):
        if size < 0:
            size = self.size - self.pos
        if size == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + size) - 1
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        with urllib.request.urlopen(request) as response:
            data = response.read()
        self.pos += len(data)
        return data

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)


# Filename fields: modality-channel-emotion-intensity-statement-repetition-actor
# emotion: 01 neutral 02 calm 03 happy 04 sad 05 angry 06 fearful 07 disgust 08 surprised
# statement 01: "Kids are talking by the door"
EMOTIONS = {"01": "neutral", "02": "calm", "03": "happy", "04": "sad", "05": "angry", "06": "fearful", "07": "disgust", "08": "surprised"}


def wanted_audio(name):
    base = os.path.basename(name)
    parts = base.replace(".wav", "").split("-")
    if len(parts) != 7 or not base.endswith(".wav"):
        return False
    modality, _channel, emotion, intensity, statement, repetition, actor = parts
    if actor not in ("01", "02") or statement != "01" or repetition != "01":
        return False
    return intensity == ("01" if emotion == "01" else "02")


def wanted_video(name):
    base = os.path.basename(name)
    parts = base.replace(".mp4", "").split("-")
    if len(parts) != 7 or not base.endswith(".mp4"):
        return False
    modality, _channel, emotion, intensity, statement, repetition, _actor = parts
    # 01 = audio+video in one file. Keep four contrasting emotions.
    if modality != "01" or statement != "01" or repetition != "01":
        return False
    return (emotion == "01" and intensity == "01") or (emotion in ("03", "05", "04") and intensity == "02")


def extract(archive, predicate, out_dir):
    remote = io.BufferedReader(RangeFile(BASE.format(name=archive)), buffer_size=1 << 20)
    with zipfile.ZipFile(remote) as zipped:
        for info in zipped.infolist():
            if not predicate(info.filename):
                continue
            target = os.path.join(out_dir, os.path.basename(info.filename))
            if os.path.exists(target):
                continue
            with zipped.open(info) as source, open(target, "wb") as sink:
                sink.write(source.read())
            print(f"{os.path.basename(target)} {info.file_size} bytes")


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    extract("Audio_Speech_Actors_01-24.zip", wanted_audio, out)
    extract("Video_Speech_Actor_01.zip", wanted_video, out)
