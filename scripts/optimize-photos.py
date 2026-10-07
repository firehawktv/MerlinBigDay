"""Convert PNG photos to JPEG (Commons serves lossless PNGs for some files, up to 11 MB)
and update credits.json. Needs Pillow:  pip install pillow
Run after scripts/fetch-photos.mjs:  python3 scripts/optimize-photos.py
"""
import json, os, sys
from PIL import Image

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
credits_path = os.path.join(root, 'photos', 'credits.json')
credits = json.load(open(credits_path))
saved = 0
for species, c in credits.items():
    for key in ('thumb', 'large'):
        if not c[key].endswith('.png'):
            continue
        src = os.path.join(root, c[key].lstrip('/'))
        dst = src[:-4] + '.jpg'
        im = Image.open(src)
        if im.mode in ('RGBA', 'LA', 'P'):
            im = im.convert('RGBA')
            bg = Image.new('RGB', im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert('RGB')
        im.save(dst, 'JPEG', quality=82, optimize=True, progressive=True)
        saved += os.path.getsize(src) - os.path.getsize(dst)
        os.remove(src)
        c[key] = c[key][:-4] + '.jpg'
json.dump(credits, open(credits_path, 'w'), indent=1)
open(credits_path, 'a').write('\n')
print(f'converted PNGs, saved {saved/1e6:.1f} MB')
