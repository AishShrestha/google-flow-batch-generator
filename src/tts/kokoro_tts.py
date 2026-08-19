#!/usr/bin/env python3
"""
Kokoro TTS - Text to Speech generator using Kokoro-82M ONNX model.

Usage:
    python kokoro_tts.py <input.txt> [options]

Options:
    --voice <name>       Voice name (default: af_sarah)
    --speed <float>      Speech speed (default: 1.0)
    --output <path>      Output WAV file path (default: output/audio/narration.wav)
    --lang <code>        Language code (default: en-us)
    --model-dir <path>   Directory containing model files (default: models/)
    --list-voices        List available voices and exit
"""

import argparse
import os
import sys
import re
import numpy as np
import soundfile as sf
from pathlib import Path


def list_voices(voices_bin_path: str):
    """List available voices from the voices.bin file."""
    from kokoro_onnx import Kokoro
    # We need the model file too to instantiate, but we can read voices separately
    # Just hardcode the known voice list from v1.0
    voices = {
        "American English (af_)": ["af_heart", "af_bella", "af_nova", "af_sarah", "af_sky"],
        "American English (am_)": ["am_adam", "am_michael", "am_puck"],
        "British English (bf_)": ["bf_alice", "bf_emma", "bf_isabella", "bf_lily"],
        "British English (bm_)": ["bm_daniel", "bm_george", "bm_lewis"],
        "Japanese (jf_)": ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tsubame"],
        "Japanese (jm_)": ["jm_kumo"],
        "Mandarin Chinese (zf_)": ["zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi"],
        "Mandarin Chinese (zm_)": ["zm_yunjian", "zm_yunxi", "zm_yunyang"],
        "Spanish (ef_)": ["ef_dora", "ef_sara", "em_alex", "em_santa"],
        "French (ff_)": ["ff_evelyne", "ff_siwon", "fm_feri"],
        "Hindi (hf_)": ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
        "Italian (if_)": ["if_sara", "im_nicola"],
        "Brazilian Portuguese (pf_)": ["pf_dora", "pm_alex"],
    }
    print("Available voices (v1.0, 54 voices across 8 languages):\n")
    for category, vlist in voices.items():
        print(f"  {category}: {', '.join(vlist)}")


def chunk_text(text: str, max_chars: int = 500) -> list[str]:
    """
    Split text into chunks suitable for Kokoro.
    Kokoro works best with chunks under ~500 chars.
    Split by sentences, then group sentences into chunks under the limit.
    """
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text.strip())

    # Split into sentences (handle . ! ? and also newlines as hard breaks)
    # Keep the delimiter with the sentence
    raw_sentences = re.split(r'(?<=[.!?])\s+|\n+', text)
    sentences = [s.strip() for s in raw_sentences if s.strip()]

    chunks = []
    current = ""

    for sentence in sentences:
        # If a single sentence is longer than max_chars, split it further
        if len(sentence) > max_chars:
            # Save current chunk if any
            if current:
                chunks.append(current.strip())
                current = ""
            # Split long sentence by commas, semicolons
            parts = re.split(r'(?<=[,;:])\s+|\s+', sentence)
            for part in parts:
                if len(current) + len(part) + 1 <= max_chars:
                    current = (current + " " + part).strip() if current else part
                else:
                    if current:
                        chunks.append(current.strip())
                    current = part
            continue

        if len(current) + len(sentence) + 1 <= max_chars:
            current = (current + " " + sentence).strip() if current else sentence
        else:
            if current:
                chunks.append(current.strip())
            current = sentence

    if current:
        chunks.append(current.strip())

    return chunks


def generate_tts(
    input_file: str,
    voice: str = "af_sarah",
    speed: float = 1.0,
    output_path: str = "output/audio/narration.wav",
    lang: str = "en-us",
    model_dir: str = "models",
):
    """Generate TTS audio from a text file, output a single concatenated WAV."""
    from kokoro_onnx import Kokoro

    model_path = os.path.join(model_dir, "kokoro-v1.0.onnx")
    voices_path = os.path.join(model_dir, "voices-v1.0.bin")

    if not os.path.exists(model_path):
        print(f"Error: Model file not found: {model_path}")
        print("Run the setup script first: npm run setup-tts")
        sys.exit(1)
    if not os.path.exists(voices_path):
        print(f"Error: Voices file not found: {voices_path}")
        print("Run the setup script first: npm run setup-tts")
        sys.exit(1)

    # Read input text
    with open(input_file, 'r', encoding='utf-8') as f:
        text = f.read()

    if not text.strip():
        print("Error: Input file is empty.")
        sys.exit(1)

    # Chunk the text
    chunks = chunk_text(text)
    total = len(chunks)
    print(f"Input: {input_file}")
    print(f"Voice: {voice}")
    print(f"Speed: {speed}x")
    print(f"Language: {lang}")
    print(f"Text length: {len(text)} chars")
    print(f"Chunks: {total}")
    print(f"Output: {output_path}")
    print()

    # Initialize Kokoro
    print("Loading model...")
    kokoro = Kokoro(model_path, voices_path)
    print("Model loaded.\n")

    # Generate audio for each chunk
    all_audio = []
    sample_rate = None

    for i, chunk in enumerate(chunks, 1):
        preview = chunk[:80] + "..." if len(chunk) > 80 else chunk
        print(f"  [{i}/{total}] Generating: {preview}")

        samples, sr = kokoro.create(chunk, voice=voice, speed=speed, lang=lang)
        all_audio.append(samples)
        sample_rate = sr

    # Concatenate all chunks into one audio array
    if all_audio:
        print("\nConcatenating audio...")
        final_audio = np.concatenate(all_audio)

        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)

        sf.write(output_path, final_audio, sample_rate)
        duration = len(final_audio) / sample_rate
        print(f"\nDone! Created: {output_path}")
        print(f"Duration: {duration:.1f}s ({duration / 60:.1f} min)")
        print(f"Sample rate: {sample_rate}Hz")
    else:
        print("Error: No audio generated.")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Kokoro TTS - Text to Speech generator")
    parser.add_argument("input", nargs="?", help="Input text file")
    parser.add_argument("--voice", default="af_sarah", help="Voice name (default: af_sarah)")
    parser.add_argument("--speed", type=float, default=1.0, help="Speech speed (default: 1.0)")
    parser.add_argument("--output", default="output/audio/narration.wav", help="Output WAV file path")
    parser.add_argument("--lang", default="en-us", help="Language code (default: en-us)")
    parser.add_argument("--model-dir", default="models", help="Directory with model files (default: models)")
    parser.add_argument("--list-voices", action="store_true", help="List available voices and exit")

    args = parser.parse_args()

    if args.list_voices:
        list_voices(os.path.join(args.model_dir, "voices-v1.0.bin"))
        return

    if not args.input:
        parser.error("input file is required (unless using --list-voices)")

    generate_tts(
        input_file=args.input,
        voice=args.voice,
        speed=args.speed,
        output_path=args.output,
        lang=args.lang,
        model_dir=args.model_dir,
    )


if __name__ == "__main__":
    main()