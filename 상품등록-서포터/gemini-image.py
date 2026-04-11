#!/usr/bin/env python3
"""
Gemini 이미지 생성 스크립트 v2 — 플랫폼별 규격 + 합본 기능

Usage:
  # 단일 블록
  python scripts/gemini-image.py \
    --product "프리미엄 꿀사과" \
    --block "히어로" \
    --block-num 1 \
    --style clean \
    --copy "달콤한 자연의 선물" \
    --output output/

  # 배치 모드 (JSON)
  python scripts/gemini-image.py \
    --blocks-json blocks.json \
    --output output/

  # 플랫폼 지정 + 합본
  python scripts/gemini-image.py \
    --blocks-json blocks.json \
    --output output/ \
    --platform coupang \
    --combine
"""

import argparse
import json
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Platform specs
# ---------------------------------------------------------------------------

PLATFORM_SPECS = {
    "coupang":     {"width": 780,  "format": "jpg", "quality": 90, "max_size_mb": 10},
    "smartstore":  {"width": 860,  "format": "jpg", "quality": 85, "max_size_mb": 2},
    "alwayz":      {"width": 720,  "format": "jpg", "quality": 85, "max_size_mb": 10},
    "toss":        {"width": 860,  "format": "jpg", "quality": 85, "max_size_mb": 2},
    "universal":   {"width": 860,  "format": "jpg", "quality": 85, "max_size_mb": 2},
}

# Toss shopping feed ad image specs
TOSS_AD_SPECS = {
    "min_side": 1280,       # 가로/세로 중 한 면 최소 1280px
    "max_size_mb": 7,       # 7MB 이하
    "formats": ["jpg", "png"],
    "text_overlay_bottom": 180,  # 하단 180px 문구 영역 (가려질 수 있음)
    "max_caption_chars": 39,     # 게시물 문구 최대 39자
    "aspect_ratios": {           # 16:9 ~ 9:16 사이
        "landscape_wide": {"w": 1280, "h": 720,  "ratio": "16:9"},
        "landscape":      {"w": 1280, "h": 960,  "ratio": "4:3"},
        "square":         {"w": 1280, "h": 1280, "ratio": "1:1"},
        "portrait":       {"w": 960,  "h": 1280, "ratio": "3:4"},
        "portrait_tall":  {"w": 720,  "h": 1280, "ratio": "9:16"},
    },
}


# ---------------------------------------------------------------------------
# API key loading
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    """Load GEMINI_API_KEY from env var or .env file."""
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key

    # Try .env in project root (script parent's parent)
    env_paths = [
        Path(__file__).resolve().parent.parent / ".env",
        Path.cwd() / ".env",
    ]
    for env_path in env_paths:
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == "GEMINI_API_KEY":
                    return v.strip().strip("\"'")

    print("ERROR: GEMINI_API_KEY not found (set env var or add to .env)")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Prompt helpers
# ---------------------------------------------------------------------------

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

STYLE_MAP = {
    "clean": "style-clean.txt",
    "premium": "style-premium.txt",
    "natural": "style-natural.txt",
    "vivid": "style-vivid.txt",
}


def load_style_prompt(style: str) -> str:
    """Load style prompt from prompts/style-{name}.txt. Returns empty string if missing."""
    filename = STYLE_MAP.get(style)
    if not filename:
        print(f"WARNING: Unknown style '{style}', using empty style prompt")
        return ""
    path = PROMPTS_DIR / filename
    if not path.exists():
        print(f"WARNING: Style file not found: {path}")
        return ""
    return path.read_text(encoding="utf-8").strip()


def load_block_prompts() -> dict[str, str]:
    """Parse prompts/block-prompts.txt into {block_name: hint_text} dict.

    File format uses [블록명] headers to separate sections.
    """
    path = PROMPTS_DIR / "block-prompts.txt"
    if not path.exists():
        return {}

    blocks: dict[str, str] = {}
    current_name: str | None = None
    lines: list[str] = []

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            # Save previous block
            if current_name is not None:
                blocks[current_name] = "\n".join(lines).strip()
            current_name = stripped[1:-1]
            lines = []
        else:
            lines.append(raw_line)

    # Save last block
    if current_name is not None:
        blocks[current_name] = "\n".join(lines).strip()

    return blocks


def build_toss_ad_prompt(
    product: str,
    style_prompt: str,
    caption: str = "",
    aspect_ratio: str = "1:1",
    width: int = 1280,
    height: int = 1280,
    extra_context: str = "",
) -> str:
    """Build Toss shopping feed ad image prompt."""
    parts = [
        "Create a professional Korean food product advertisement image for Toss Shopping feed.",
        "This is a social-feed-style ad image that appears in users' Toss app feed.",
        "",
        f"Product: {product}",
        f"Image size: {width}x{height}px ({aspect_ratio})",
        "",
    ]

    if style_prompt:
        parts.append(style_prompt)
        parts.append("")

    parts.extend([
        "COMPOSITION RULES:",
        "- The product should be the hero — large, centered, appetizing.",
        "- Use natural, lifestyle-oriented photography style (not sterile studio shots).",
        "- Warm, inviting lighting that makes food look delicious.",
        f"- IMPORTANT: The bottom {TOSS_AD_SPECS['text_overlay_bottom']}px will be overlaid with text by the platform.",
        "  Keep the bottom area relatively simple/dark — avoid placing key product details there.",
        "  The main product and visual focal point should be in the upper 2/3 of the image.",
        "",
    ])

    if caption:
        parts.extend([
            "The following caption will be shown as text overlay by the platform (do NOT render it in the image):",
            f'  "{caption}"',
            "",
        ])

    if extra_context:
        parts.append(extra_context)
        parts.append("")

    parts.extend([
        "STYLE:",
        "- Clean, premium Korean food advertising aesthetic.",
        "- No text, no labels, no watermarks in the image itself.",
        "- The platform handles all text overlay — generate a PURE product image.",
        "- High resolution, vibrant colors, appetizing presentation.",
        "- Think: Instagram food ads, Toss Shopping feed, Market Kurly banner style.",
        "",
        "CRITICAL RULES:",
        "- DO NOT include ANY text in the image — no Korean, no English, no numbers, no labels.",
        "- DO NOT include price tags, discount badges, or promotional text.",
        "- The image must work as a standalone visual that grabs attention in a social feed.",
    ])

    return "\n".join(parts)


def build_prompt(
    product: str,
    block_name: str,
    block_num: int,
    style_prompt: str,
    copy_text: str,
    block_hint: str = "",
    extra_context: str = "",
    width: int = 860,
) -> str:
    """Build the image generation prompt."""
    parts = [
        "Create a Korean food e-commerce product detail page image section.",
        "Follow the standard Korean food e-commerce detail page format (쿠팡, 마켓컬리, 스마트스토어 style).",
        "",
        f"Product: {product}",
        "",
    ]

    if style_prompt:
        parts.append(style_prompt)
        parts.append("")

    parts.append("Text content to include IN the image (Korean):")
    parts.append(copy_text)
    parts.append("")

    if block_hint:
        parts.append(block_hint)
        parts.append("")

    if extra_context:
        parts.append(extra_context)
        parts.append("")

    parts.extend([
        f"Layout: Vertical format, {width}px wide style for mobile shopping",
        "IMPORTANT: All Korean text must be clearly readable and correctly rendered.",
        "IMPORTANT: This is one section of a product detail page, not a full page.",
        "",
        "CRITICAL RULES:",
        "- DO NOT include any price or cost information unless explicitly provided in the copy text above.",
        "- DO NOT show internal section labels like '셀링포인트', '시즐컷', '소셜프루프', '히어로', 'CTA' etc. These are internal names, NOT consumer-facing text.",
        "- DO NOT show section numbers (01, 02, etc.) in the image.",
        "- The image should look like a real product detail page section that a consumer would see on Coupang or Market Kurly.",
        "- Only display the actual marketing copy text provided above — nothing else.",
    ])

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Image generation
# ---------------------------------------------------------------------------

def generate_image(client, prompt: str) -> bytes | None:
    """Call Gemini API and return PNG bytes, or None on failure."""
    from google.genai import types

    try:
        response = client.models.generate_content(
            model="gemini-3-pro-image-preview",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )
    except Exception as e:
        print(f"  ERROR: API call failed — {e}")
        return None

    # Extract image from response parts
    if not response.candidates:
        print("  ERROR: No candidates in response")
        return None

    for part in response.candidates[0].content.parts:
        if part.inline_data and part.inline_data.mime_type.startswith("image/"):
            return part.inline_data.data

    print("  WARNING: Response contained no image data")
    return None


def save_image(
    data: bytes,
    output_dir: Path,
    block_num: int,
    block_name: str,
    platform: str = "universal",
    quality_override: int = None,
) -> Path:
    """Save image bytes, resize to platform width, convert to platform format.

    Steps:
    1. Write raw bytes to a temp file
    2. Open with Pillow
    3. Resize width to platform spec (maintain aspect ratio) if image is wider
    4. Save as JPG or PNG based on platform format spec
    5. Check file size against max_size_mb, reduce quality if needed
    6. Return final file path
    """
    from PIL import Image
    import io

    spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["universal"])
    target_width = spec["width"]
    fmt = spec["format"].lower()
    quality = quality_override if quality_override is not None else spec["quality"]
    max_size_bytes = spec["max_size_mb"] * 1024 * 1024

    output_dir.mkdir(parents=True, exist_ok=True)

    # Determine output filename
    ext = "jpg" if fmt == "jpg" else "png"
    filename = f"{block_num:02d}_{block_name}.{ext}"
    filepath = output_dir / filename

    # Open image from raw bytes
    img = Image.open(io.BytesIO(data))

    # Convert RGBA/P to RGB for JPG compatibility
    if fmt == "jpg" and img.mode in ("RGBA", "P", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode in ("RGBA", "LA"):
            background.paste(img, mask=img.split()[-1])
        else:
            background.paste(img)
        img = background
    elif fmt == "jpg" and img.mode != "RGB":
        img = img.convert("RGB")

    # Resize width if image is wider than target
    if img.width > target_width:
        ratio = target_width / img.width
        new_height = int(img.height * ratio)
        img = img.resize((target_width, new_height), Image.LANCZOS)

    # Save with quality adjustment loop to meet max_size_mb
    save_format = "JPEG" if fmt == "jpg" else "PNG"
    current_quality = quality

    while current_quality >= 60:
        buffer = io.BytesIO()
        if save_format == "JPEG":
            img.save(buffer, format=save_format, quality=current_quality, optimize=True)
        else:
            img.save(buffer, format=save_format, optimize=True)

        size = buffer.tell()
        if size <= max_size_bytes or save_format == "PNG":
            filepath.write_bytes(buffer.getvalue())
            if size > max_size_bytes:
                print(f"  WARNING: File size {size / 1024 / 1024:.1f}MB exceeds {spec['max_size_mb']}MB limit (PNG cannot reduce further)")
            break

        current_quality -= 5
        print(f"  Reducing quality to {current_quality} (size: {size / 1024 / 1024:.1f}MB)")
    else:
        # Final fallback: save at minimum quality
        buffer = io.BytesIO()
        img.save(buffer, format=save_format, quality=60, optimize=True)
        filepath.write_bytes(buffer.getvalue())

    return filepath


# ---------------------------------------------------------------------------
# Combine images
# ---------------------------------------------------------------------------

def combine_images(image_dir: Path, output_path: Path, platform: str = "universal") -> Path | None:
    """Vertically stitch all block images in image_dir into one long image.

    - Sorts by filename (01_, 02_, etc.)
    - Resizes all to same width (platform width)
    - Vertically concatenates
    - Saves as combined_전체.jpg
    """
    from PIL import Image

    spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["universal"])
    target_width = spec["width"]

    # Collect image files sorted by name
    image_extensions = {".jpg", ".jpeg", ".png", ".webp"}
    image_files = sorted(
        [f for f in image_dir.iterdir() if f.suffix.lower() in image_extensions and f.stem != "combined_전체"],
        key=lambda f: f.name,
    )

    if not image_files:
        print(f"  WARNING: No images found in {image_dir}")
        return None

    print(f"Combining {len(image_files)} images → {output_path}")

    images = []
    for img_path in image_files:
        img = Image.open(img_path)

        # Convert to RGB for JPG output
        if img.mode in ("RGBA", "P", "LA"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode in ("RGBA", "LA"):
                background.paste(img, mask=img.split()[-1])
            else:
                background.paste(img)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # Resize to target width
        if img.width != target_width:
            ratio = target_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((target_width, new_height), Image.LANCZOS)

        images.append(img)
        print(f"  + {img_path.name} ({img.width}×{img.height})")

    # Calculate total height
    total_height = sum(img.height for img in images)

    # Create canvas and paste
    canvas = Image.new("RGB", (target_width, total_height), (255, 255, 255))
    y_offset = 0
    for img in images:
        canvas.paste(img, (0, y_offset))
        y_offset += img.height

    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(str(output_path), format="JPEG", quality=spec["quality"], optimize=True)
    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"  Saved combined: {output_path} ({target_width}×{total_height}px, {size_mb:.1f}MB)")

    return output_path


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def run_toss_ad(args) -> bool:
    """Toss shopping feed ad image generation mode."""
    from google import genai

    api_key = load_api_key()
    client = genai.Client(api_key=api_key)

    style_prompt = load_style_prompt(args.style)

    # Determine aspect ratio dimensions
    ratio_key = args.toss_ratio or "square"
    ratio_info = TOSS_AD_SPECS["aspect_ratios"].get(ratio_key)
    if not ratio_info:
        print(f"ERROR: Unknown ratio '{ratio_key}'. Available: {list(TOSS_AD_SPECS['aspect_ratios'].keys())}")
        return False

    w, h = ratio_info["w"], ratio_info["h"]
    ratio_label = ratio_info["ratio"]

    caption = getattr(args, "toss_caption", "") or ""
    if caption and len(caption) > TOSS_AD_SPECS["max_caption_chars"]:
        print(f"WARNING: Caption is {len(caption)} chars (max {TOSS_AD_SPECS['max_caption_chars']}). Truncating.")
        caption = caption[:TOSS_AD_SPECS["max_caption_chars"]]

    extra = getattr(args, "toss_context", "") or ""

    prompt = build_toss_ad_prompt(
        product=args.product,
        style_prompt=style_prompt,
        caption=caption,
        aspect_ratio=ratio_label,
        width=w,
        height=h,
        extra_context=extra,
    )

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    variation = getattr(args, "toss_variation", "A") or "A"

    if args.prompt_only:
        prompt_file = output_dir / f"toss_ad_{variation}_prompt.txt"
        prompt_file.write_text(prompt, encoding="utf-8")
        print(f"[prompt-only] {prompt_file}")
        print(prompt)
        return True

    print(f"Generating Toss ad: {ratio_label} ({w}x{h}px), variation {variation}")
    image_data = generate_image(client, prompt)
    if not image_data:
        print("  FAILED")
        return False

    # Save with Toss ad specs
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(image_data))

    # Convert to RGB
    if img.mode in ("RGBA", "P", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode in ("RGBA", "LA"):
            background.paste(img, mask=img.split()[-1])
        else:
            background.paste(img)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Resize to target dimensions
    img = img.resize((w, h), Image.LANCZOS)

    # Save as JPG
    fmt = "jpg"
    filename = f"toss_ad_{variation}.{fmt}"
    filepath = output_dir / filename
    max_size_bytes = TOSS_AD_SPECS["max_size_mb"] * 1024 * 1024
    quality = 90

    while quality >= 60:
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=quality, optimize=True)
        if buffer.tell() <= max_size_bytes:
            filepath.write_bytes(buffer.getvalue())
            break
        quality -= 5
        print(f"  Reducing quality to {quality} (size: {buffer.tell() / 1024 / 1024:.1f}MB)")
    else:
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=60, optimize=True)
        filepath.write_bytes(buffer.getvalue())

    size_mb = filepath.stat().st_size / 1024 / 1024
    print(f"  Saved: {filepath} ({w}x{h}px, {size_mb:.1f}MB)")
    return True


def run_prompt_only_single(args) -> bool:
    """Single block prompt-only mode — output prompt without calling API."""
    platform = getattr(args, "platform", "universal")
    spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["universal"])
    width = spec["width"]

    style_prompt = load_style_prompt(args.style)
    block_prompts = load_block_prompts()
    block_hint = block_prompts.get(args.block, "")

    prompt = build_prompt(
        product=args.product,
        block_name=args.block,
        block_num=args.block_num,
        style_prompt=style_prompt,
        copy_text=args.copy,
        block_hint=block_hint,
        width=width,
    )

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    prompt_file = output_dir / f"{args.block_num:02d}_{args.block}_prompt.txt"
    prompt_file.write_text(prompt, encoding="utf-8")
    print(f"[prompt-only] {prompt_file}")
    print(prompt)
    return True


def run_prompt_only_batch(args) -> bool:
    """Batch prompt-only mode — output all prompts without calling API."""
    json_path = Path(args.blocks_json)
    if not json_path.exists():
        print(f"ERROR: JSON file not found: {json_path}")
        return False

    data = json.loads(json_path.read_text(encoding="utf-8"))
    product = data["product"]
    style = data.get("style", "clean")
    blocks = data["blocks"]

    platform = getattr(args, "platform", "universal")
    spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["universal"])
    width = spec["width"]

    style_prompt = load_style_prompt(style)
    block_prompts = load_block_prompts()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Product:  {product}")
    print(f"Style:    {style}")
    print(f"Platform: {platform} (width: {width}px)")
    print(f"Blocks:   {len(blocks)}")
    print(f"Output:   {output_dir}")
    print("=" * 60)

    all_prompts = []
    for idx, block in enumerate(blocks, start=1):
        name = block["name"]
        copy = block.get("copy", "")
        context = block.get("context", "")
        block_hint = block_prompts.get(name, "")

        prompt = build_prompt(
            product=product,
            block_name=name,
            block_num=idx,
            style_prompt=style_prompt,
            copy_text=copy,
            block_hint=block_hint,
            extra_context=context,
            width=width,
        )

        # Save individual prompt file
        prompt_file = output_dir / f"{idx:02d}_{name}_prompt.txt"
        prompt_file.write_text(prompt, encoding="utf-8")

        all_prompts.append(f"### [{idx}] {name}\n\n{prompt}")
        print(f"[{idx}/{len(blocks)}] {prompt_file.name}")

    # Save combined prompts file
    combined = f"# {product} — 이미지 프롬프트 모음\n\n" + "\n\n---\n\n".join(all_prompts) + "\n"
    combined_file = output_dir / "all_prompts.md"
    combined_file.write_text(combined, encoding="utf-8")
    print("=" * 60)
    print(f"All prompts saved: {combined_file}")
    return True


def run_single(args) -> bool:
    """Single block mode."""
    from google import genai

    api_key = load_api_key()
    client = genai.Client(api_key=api_key)

    platform = getattr(args, "platform", "universal")
    spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["universal"])
    width = spec["width"]

    style_prompt = load_style_prompt(args.style)
    block_prompts = load_block_prompts()
    block_hint = block_prompts.get(args.block, "")

    prompt = build_prompt(
        product=args.product,
        block_name=args.block,
        block_num=args.block_num,
        style_prompt=style_prompt,
        copy_text=args.copy,
        block_hint=block_hint,
        width=width,
    )

    ext = spec["format"]
    print(f"Generating: {args.block_num:02d}_{args.block}.{ext}  [platform: {platform}, width: {width}px]")
    image_data = generate_image(client, prompt)
    if not image_data:
        print("  FAILED")
        return False

    out = save_image(image_data, Path(args.output), args.block_num, args.block, platform=platform, quality_override=getattr(args, 'quality', None))
    print(f"  Saved: {out}")
    return True


def run_batch(args) -> bool:
    """Batch mode from JSON file."""
    from google import genai

    json_path = Path(args.blocks_json)
    if not json_path.exists():
        print(f"ERROR: JSON file not found: {json_path}")
        return False

    data = json.loads(json_path.read_text(encoding="utf-8"))
    product = data["product"]
    style = data.get("style", "clean")
    blocks = data["blocks"]

    platform = getattr(args, "platform", "universal")
    spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["universal"])
    width = spec["width"]

    api_key = load_api_key()
    client = genai.Client(api_key=api_key)

    style_prompt = load_style_prompt(style)
    block_prompts = load_block_prompts()
    output_dir = Path(args.output)

    print(f"Product:  {product}")
    print(f"Style:    {style}")
    print(f"Platform: {platform} (width: {width}px, format: {spec['format']})")
    print(f"Blocks:   {len(blocks)}")
    print(f"Output:   {output_dir}")
    print("-" * 40)

    success_count = 0
    for idx, block in enumerate(blocks, start=1):
        name = block["name"]
        copy = block.get("copy", "")
        context = block.get("context", "")
        block_hint = block_prompts.get(name, "")

        prompt = build_prompt(
            product=product,
            block_name=name,
            block_num=idx,
            style_prompt=style_prompt,
            copy_text=copy,
            block_hint=block_hint,
            extra_context=context,
            width=width,
        )

        ext = spec["format"]
        print(f"[{idx}/{len(blocks)}] Generating: {idx:02d}_{name}.{ext}")
        image_data = generate_image(client, prompt)
        if image_data:
            out = save_image(image_data, output_dir, idx, name, platform=platform, quality_override=getattr(args, 'quality', None))
            print(f"  Saved: {out}")
            success_count += 1
        else:
            print("  FAILED")

    print("-" * 40)
    print(f"Done: {success_count}/{len(blocks)} images generated")
    return success_count == len(blocks)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Gemini 이미지 생성 v2 — 식품 상세페이지 블록 이미지 (플랫폼별 규격 + 합본)",
    )

    # Single block mode
    parser.add_argument("--product", help="상품명")
    parser.add_argument("--block", help="블록 이름 (e.g. 히어로)")
    parser.add_argument("--block-num", type=int, help="블록 번호")
    parser.add_argument("--style", default="clean", help="스타일 (clean/premium/natural/vivid)")
    parser.add_argument("--copy", help="카피 텍스트")

    # Batch mode
    parser.add_argument("--blocks-json", help="배치 모드 JSON 파일 경로")

    # Common
    parser.add_argument("--output", default="output", help="출력 디렉토리 (default: output/)")

    # Platform
    parser.add_argument(
        "--platform",
        default="universal",
        choices=list(PLATFORM_SPECS.keys()),
        help="타겟 플랫폼 (default: universal)",
    )

    # Image quality override
    parser.add_argument(
        "--quality",
        type=int,
        default=None,
        choices=[60, 70, 75, 80, 85, 90, 95],
        help="JPEG 이미지 품질 (60~95, default: 플랫폼 기본값 사용)",
    )

    # Combine
    parser.add_argument(
        "--combine",
        action="store_true",
        help="배치 생성 후 모든 블록 이미지를 세로로 합본 (combined_전체.jpg)",
    )

    # Prompt-only
    parser.add_argument(
        "--prompt-only",
        action="store_true",
        help="이미지 생성 없이 프롬프트만 출력/저장 (API 호출 안 함)",
    )

    # Toss ad mode
    parser.add_argument(
        "--toss-ad",
        action="store_true",
        help="토스 쇼핑 피드 게시물 광고 이미지 생성 모드",
    )
    parser.add_argument(
        "--toss-ratio",
        default="square",
        choices=list(TOSS_AD_SPECS["aspect_ratios"].keys()),
        help="토스 광고 비율 (default: square)",
    )
    parser.add_argument(
        "--toss-caption",
        default="",
        help="토스 게시물 문구 (최대 39자, 이미지에 포함 안 됨)",
    )
    parser.add_argument(
        "--toss-variation",
        default="A",
        help="변형 ID (A/B/C)",
    )
    parser.add_argument(
        "--toss-context",
        default="",
        help="추가 컨텍스트 (상품 특징 등)",
    )

    args = parser.parse_args()

    # Determine mode
    if args.toss_ad:
        if not args.product:
            parser.print_help()
            print("\nERROR: --toss-ad requires --product")
            sys.exit(1)
        ok = run_toss_ad(args)
    elif args.prompt_only:
        if args.blocks_json:
            ok = run_prompt_only_batch(args)
        elif args.product and args.block and args.block_num and args.copy:
            ok = run_prompt_only_single(args)
        else:
            parser.print_help()
            print("\nERROR: --prompt-only requires same args as normal mode (--blocks-json or --product/--block/--block-num/--copy)")
            sys.exit(1)
    elif args.blocks_json:
        ok = run_batch(args)
        if ok and args.combine:
            output_dir = Path(args.output)
            combined_path = output_dir / "combined_전체.jpg"
            combine_images(output_dir, combined_path, platform=args.platform)
    elif args.product and args.block and args.block_num and args.copy:
        ok = run_single(args)
    else:
        parser.print_help()
        print("\nERROR: Provide --blocks-json for batch mode, or --product/--block/--block-num/--copy for single mode")
        sys.exit(1)

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
