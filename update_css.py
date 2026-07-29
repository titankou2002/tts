import codecs
import re

file_path = "g:/我的雲端硬碟/BT/Antigravity/智慧物流系統/Index.html"
with codecs.open(file_path, "r", "utf-8") as f:
    data = f.read()

data = data.replace("--card:", "--surface:")
data = data.replace("--text-main:", "--text-primary:")
data = data.replace("--text-sub", "--text-secondary")
data = data.replace("--primary-hover", "--primary-soft")

data = data.replace("var(--card)", "var(--surface)")
data = data.replace("var(--text-main)", "var(--text-primary)")
data = data.replace("var(--text-sub)", "var(--text-secondary)")
data = data.replace("var(--primary-light)", "var(--primary-soft)")
data = data.replace("color: var(--text);", "color: var(--text-primary);")
data = data.replace("color: #94a3b8;", "color: var(--text-secondary);")
data = data.replace("color: #000;", "color: var(--bg);") 

root_old = """        :root {
            --bg: #0E1824;
            --surface: rgba(20, 32, 48, 0.88);
            --primary: #1E3A5F;
            --primary-soft: #274A75;
            --secondary: #2B3F56;
            --success: #2F5E4E;
            --warning: #B8791C;
            --danger: #7A2A2A;
            --text-primary: #E4ECF5;
            --text-secondary: #A8B6C8;
            --border-soft: rgba(255, 255, 255, 0.06);
        }"""

root_new = """        :root {
            --bg: #0E1824;
            --surface: rgba(20, 32, 48, 0.88);
            --primary: #1E3A5F;
            --primary-soft: #274A75;
            --secondary: #2B3F56;
            --success: #2F5E4E;
            --warning: #B8791C;
            --danger: #7A2A2A;
            --text-primary: #E4ECF5;
            --text-secondary: #A8B6C8;
            --text-tertiary: #7E8DA0;
            --border-soft: rgba(255, 255, 255, 0.06);
        }"""
data = data.replace(root_old, root_new)


task_card_old = """        .task-card {
            background: var(--surface);
            border-radius: 14px;
            padding: 16px;
            margin-bottom: 12px;
            border: 1px solid var(--border-soft);
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
            display: flex;
            gap: 15px;
            position: relative;
        }"""
task_card_new = """        .task-card {
            background: var(--surface);
            border-radius: 14px;
            padding: 18px 16px;
            margin-bottom: 14px;
            border: 1px solid var(--border-soft);
            border-top: 1px solid rgba(255, 255, 255, 0.04);
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
            display: flex;
            gap: 15px;
            position: relative;
        }"""
data = data.replace(task_card_old, task_card_new)

overlay_old = """        .overlay {
            position: fixed;
            inset: 0;
            background: rgba(15, 27, 42, 0.92);
            backdrop-filter: blur(8px);
            z-index: 1000;
            overflow-y: auto;
            display: none;
            padding: 20px;
        }"""
overlay_new = """        @keyframes overlayFadeUp {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .overlay {
            position: fixed;
            inset: 0;
            background: var(--surface);
            backdrop-filter: blur(8px);
            z-index: 1000;
            overflow-y: auto;
            display: none;
            padding: 20px;
        }
        .overlay[style*="display: block"] {
            animation: overlayFadeUp 0.2s ease-out forwards;
        }"""
data = data.replace(overlay_old, overlay_new)

with codecs.open(file_path, "w", "utf-8") as f:
    f.write(data)
print("Done")
