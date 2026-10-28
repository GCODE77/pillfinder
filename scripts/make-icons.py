"""필파인더 아이콘: 돋보기 렌즈 안에 알약.
  python scripts/make-icons.py                # 후보 7종 → icons/candidates/*.png 과 비교표 candidates.png
  python scripts/make-icons.py apply C        # 고른 후보(A~G)를 앱 아이콘(icons/*.png)으로 적용
  (적용 후 app의 sw.js CACHE 번호를 올려야 설치된 앱에도 새 아이콘이 간다)
"""
import math
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ICONS = os.path.join(ROOT, 'icons')
CAND = os.path.join(ICONS, 'candidates')
SS = 2048  # 슈퍼샘플 크기(마지막에 줄여서 부드럽게)

NAVY, YELLOW, WHITE, GOLD = '#0f172a', '#facc15', '#f8fafc', '#f0c75e'

# 이름: (제목, 설명, 배경, 고리색, 렌즈 안 색(없으면 None), 알약 종류, 알약 색 두 개, 광택)
DESIGNS = {
    'A': dict(title='A 금빛 돋보기', note='남색 바탕 · 금색 돋보기 · 흰/금 캡슐 (보내주신 예시와 가장 비슷)',
              bg=NAVY, ring=GOLD, lens=None, pill='capsule', colors=(WHITE, GOLD), shine=False),
    'B': dict(title='B 노랑 바탕', note='앱 포인트색 노랑 바탕 · 남색 돋보기 · 남/흰 캡슐',
              bg=YELLOW, ring=NAVY, lens='#fff7cc', pill='capsule', colors=(NAVY, WHITE), shine=False),
    'C': dict(title='C 흰 바탕', note='밝은 바탕 · 남색 돋보기 · 노랑/남색 캡슐',
              bg='#f1f5f9', ring=NAVY, lens='#ffffff', pill='capsule', colors=(YELLOW, NAVY), shine=False),
    'D': dict(title='D 청록 그라데이션', note='의료 느낌 청록→파랑 · 흰 돋보기 · 흰/노랑 캡슐',
              bg=('#14b8a6', '#1d4ed8'), ring=WHITE, lens=(255, 255, 255, 40), pill='capsule', colors=(WHITE, YELLOW), shine=True),
    'E': dict(title='E 큰 캡슐', note='남색 바탕 · 굵은 금색 돋보기 · 렌즈를 꽉 채운 큰 캡슐 + 유리 반사',
              bg=NAVY, ring=YELLOW, lens=(255, 255, 255, 22), pill='capsule_big', colors=(WHITE, YELLOW), shine=True),
    'F': dict(title='F 둥근 정제', note='남색 바탕 · 금색 돋보기 · 분할선 있는 흰 둥근 정제',
              bg=NAVY, ring=GOLD, lens=None, pill='tablet', colors=(WHITE, WHITE), shine=False),
    'G': dict(title='G 코랄 그라데이션', note='따뜻한 코랄→주황 · 흰 돋보기 · 흰/남색 캡슐',
              bg=('#fb7185', '#f97316'), ring=WHITE, lens=(255, 255, 255, 40), pill='capsule', colors=(WHITE, NAVY), shine=True),
}


def u(v):
    return v * SS


def hex_to_rgba(c, a=255):
    if isinstance(c, tuple):
        return c if len(c) == 4 else (*c, a)
    c = c.lstrip('#')
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), a)


def make_bg(bg):
    if isinstance(bg, tuple) and isinstance(bg[0], str):  # 그라데이션(위→아래)
        top, bot = Image.new('RGBA', (SS, SS), hex_to_rgba(bg[0])), Image.new('RGBA', (SS, SS), hex_to_rgba(bg[1]))
        m = Image.linear_gradient('L').resize((SS, SS))
        return Image.composite(bot, top, m)
    return Image.new('RGBA', (SS, SS), hex_to_rgba(bg))


def capsule_layer(cx, cy, length, width, angle, c1, c2):
    """가로로 그린 두 색 캡슐을 angle도 돌려서 반환(이음매 선·윗면 광택 포함)."""
    mask = Image.new('L', (SS, SS), 0)
    x0, x1, y0, y1 = cx - length / 2, cx + length / 2, cy - width / 2, cy + width / 2
    ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x1, y1], radius=width / 2, fill=255)
    base = Image.new('RGBA', (SS, SS), hex_to_rgba(c2))
    half = Image.new('L', (SS, SS), 0)
    ImageDraw.Draw(half).rectangle([0, 0, cx + width * 0.05, SS], fill=255)   # 왼쪽 반
    comp = Image.composite(Image.new('RGBA', (SS, SS), hex_to_rgba(c1)), base, half)
    layer = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
    layer.paste(comp, (0, 0), mask)
    d = ImageDraw.Draw(layer)
    # 이음매
    sx = cx + width * 0.05
    d.line([(sx, y0 + width * 0.04), (sx, y1 - width * 0.04)], fill=(15, 23, 42, 70), width=int(width * 0.035))
    # 윗면 광택
    sh = Image.new('L', (SS, SS), 0)
    ImageDraw.Draw(sh).rounded_rectangle([x0 + width * 0.30, y0 + width * 0.12, x1 - width * 0.30, y0 + width * 0.26], radius=width * 0.07, fill=110)
    layer.paste(Image.new('RGBA', (SS, SS), (255, 255, 255, 255)), (0, 0), Image.composite(sh, Image.new('L', (SS, SS), 0), mask))
    return layer.rotate(angle, center=(cx, cy), resample=Image.BICUBIC)


def tablet_layer(cx, cy, r, color):
    layer = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - r + r * 0.05, cy - r + r * 0.09, cx + r + r * 0.05, cy + r + r * 0.09], fill=(15, 23, 42, 60))   # 그림자
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=hex_to_rgba(color))
    # 분할선: 비스듬히(가로선은 '빼기' 기호처럼 보인다) + 가장자리 입체감
    ca, sa = math.cos(math.radians(-35)), math.sin(math.radians(-35))
    d.line([(cx - r * 0.78 * ca, cy - r * 0.78 * sa), (cx + r * 0.78 * ca, cy + r * 0.78 * sa)], fill=(148, 163, 184, 255), width=int(r * 0.08))
    d.ellipse([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86], outline=(226, 232, 240, 255), width=int(r * 0.05))
    return layer


def render(key, content_scale=1.0):
    """1024 기준 비율로 그린 SS 크기의 아이콘(배경 포함, 모서리는 아직 각짐)."""
    dz = DESIGNS[key]
    img = make_bg(dz['bg'])
    # 돋보기: 렌즈 중심과 크기(내용물은 content_scale로 줄여 maskable 안전영역을 확보)
    s = content_scale
    cx = cy = 0.5 + (0.5 - 0.46) * 0   # 기준 중심
    lx, ly = 0.5 - 0.5 * (1 - s) + 0.0, 0.5
    def P(x, y):  # 0~1 좌표를 중심 기준으로 s배
        return u(0.5 + (x - 0.5) * s), u(0.5 + (y - 0.5) * s)
    R = 0.285 * s
    mx, my = P(0.45, 0.44)
    ring_w = (0.062 if key == 'E' else 0.048) * s * SS
    lens_r = u(R)
    layer = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ang = math.radians(45)
    hx0, hy0 = mx + lens_r * math.cos(ang), my + lens_r * math.sin(ang)
    hx1, hy1 = mx + (lens_r + u(0.2 * s)) * math.cos(ang), my + (lens_r + u(0.2 * s)) * math.sin(ang)
    hw = u(0.082 * s)
    ringc = hex_to_rgba(dz['ring'])
    d.line([(hx0, hy0), (hx1, hy1)], fill=ringc, width=int(hw))                          # 손잡이
    d.ellipse([hx1 - hw / 2, hy1 - hw / 2, hx1 + hw / 2, hy1 + hw / 2], fill=ringc)
    if dz['lens']:
        d.ellipse([mx - lens_r, my - lens_r, mx + lens_r, my + lens_r], fill=hex_to_rgba(dz['lens']))
    d.ellipse([mx - lens_r, my - lens_r, mx + lens_r, my + lens_r], outline=ringc, width=int(ring_w))  # 고리
    img = Image.alpha_composite(img, layer)
    # 알약
    c1, c2 = dz['colors']
    if dz['pill'] == 'tablet':
        pl = tablet_layer(mx, my, lens_r * 0.62, c1)
    else:
        big = dz['pill'] == 'capsule_big'
        length, width = (lens_r * 1.42, lens_r * 0.62) if big else (lens_r * 1.16, lens_r * 0.5)
        pl = capsule_layer(mx, my, length, width, 40, c1, c2)
    img = Image.alpha_composite(img, pl)
    if dz['shine']:  # 렌즈 유리 반사(왼쪽 위 호)
        sl = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
        ImageDraw.Draw(sl).arc([mx - lens_r * 0.8, my - lens_r * 0.8, mx + lens_r * 0.8, my + lens_r * 0.8], 195, 250, fill=(255, 255, 255, 190), width=int(ring_w * 0.55))
        img = Image.alpha_composite(img, sl)
    return img


def finish(img, size, rounded=True):
    out = img.resize((size, size), Image.LANCZOS)
    if rounded:
        mask = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * 0.22), fill=255)
        out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


def candidates():
    os.makedirs(CAND, exist_ok=True)
    font = ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf', 30)
    small = ImageFont.truetype('C:/Windows/Fonts/malgun.ttf', 20)
    cols, cell_w, cell_h, pad = 4, 420, 590, 26
    rows = math.ceil(len(DESIGNS) / cols)
    sheet = Image.new('RGB', (cols * cell_w + pad, rows * cell_h + pad + 70), '#e2e8f0')
    d = ImageDraw.Draw(sheet)
    d.text((pad, 18), '필파인더 아이콘 후보 — 돋보기 안에 알약', font=ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf', 34), fill='#0f172a')
    for i, key in enumerate(DESIGNS):
        full = render(key)
        for size in (512,):
            finish(full, size).save(os.path.join(CAND, f'{key}-{size}.png'))
        x0, y0 = pad + (i % cols) * cell_w, 70 + pad + (i // cols) * cell_h
        big = finish(full, 330)
        sheet.paste(big, (x0, y0), big)
        d.text((x0, y0 + 340), DESIGNS[key]['title'], font=font, fill='#0f172a')
        # 설명(줄바꿈)
        words, line, ly = DESIGNS[key]['note'], '', y0 + 382
        for ch in words:
            if d.textlength(line + ch, font=small) > cell_w - pad * 2:
                d.text((x0, ly), line, font=small, fill='#334155'); ly += 26; line = ''
            line += ch
        d.text((x0, ly), line, font=small, fill='#334155')
        # 실제 쓰이는 작은 크기(홈 화면 64, 탭 32)
        for j, sz in enumerate((72, 48, 32)):
            sm = finish(full, sz)
            sheet.paste(sm, (x0 + j * 90, y0 + 482), sm)
    sheet.save(os.path.join(ICONS, 'candidates.png'))
    print('후보', list(DESIGNS), '→ icons/candidates/, icons/candidates.png')


def apply(key):
    full = render(key)
    finish(full, 512).save(os.path.join(ICONS, 'icon-512.png'))
    finish(full, 192).save(os.path.join(ICONS, 'icon-192.png'))
    finish(full, 32).save(os.path.join(ICONS, 'favicon-32.png'))
    finish(render(key), 180, rounded=False).convert('RGB').save(os.path.join(ICONS, 'apple-touch-icon.png'))
    finish(render(key, content_scale=0.78), 512, rounded=False).convert('RGB').save(os.path.join(ICONS, 'maskable-512.png'))  # 안전영역
    print('적용:', DESIGNS[key]['title'])


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'apply':
        apply(sys.argv[2].upper())
    else:
        candidates()
