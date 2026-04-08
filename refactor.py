import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

style_match = re.search(r'<style>(.*?)</style>', html, flags=re.DOTALL)
if style_match:
    css_content = style_match.group(1)
    css_content = css_content.replace('url("3.jpg")', 'url("cover/3.jpg")')
    css_content = css_content.replace('url("天外来物.jpg")', 'url("cover/天外来物.jpg")')
    css_content = css_content.replace('"3.jpg"', '"cover/3.jpg"')
    css_content = css_content.replace('"天外来物.jpg"', '"cover/天外来物.jpg"')
    
    with open('style.css', 'w', encoding='utf-8') as f:
        f.write(css_content.strip() + '\n')
    
    html = html.replace(style_match.group(0), '<link rel="stylesheet" href="style.css">')

script_match = re.search(r'<script>(.*?)</script>', html, flags=re.DOTALL)
if script_match:
    js_content = script_match.group(1)
    js_content = js_content.replace("'3.jpg'", "'cover/3.jpg'")
    js_content = js_content.replace("'4.jpg'", "'cover/4.jpg'")
    js_content = js_content.replace("'1.jpg'", "'cover/1.jpg'")
    js_content = js_content.replace("'2.jpg'", "'cover/2.jpg'")
    js_content = js_content.replace('audioEl.src = encodeURIComponent(audioFileName);', "audioEl.src = 'musics/' + encodeURIComponent(audioFileName);")
    
    with open('main.js', 'w', encoding='utf-8') as f:
        f.write(js_content.strip() + '\n')
    
    html = html.replace(script_match.group(0), '<script src="main.js"></script>')

html = html.replace('src="3.jpg"', 'src="cover/3.jpg"')
html = html.replace('src="4.jpg"', 'src="cover/4.jpg"')
html = html.replace('src="1.jpg"', 'src="cover/1.jpg"')
html = html.replace('src="2.jpg"', 'src="cover/2.jpg"')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Refactoring completed successfully.')
