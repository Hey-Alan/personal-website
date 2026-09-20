#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
字数统计器 —— 写作打卡小工具（示例程序，可替换成你自己的）

用法：
    python word_counter.py 小说.txt

统计：总字符（不含空白）、汉字数、英文单词数、段落数、行数。
自动尝试 utf-8 / gbk / utf-16 编码。
"""

import re
import sys


def read_text(path):
    for enc in ("utf-8-sig", "utf-8", "gbk", "utf-16"):
        try:
            with open(path, encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise SystemExit(f"无法识别文件编码：{path}")


def count(text):
    lines = text.splitlines()
    paragraphs = [ln for ln in lines if ln.strip()]
    chinese = re.findall(r"[\u4e00-\u9fff]", text)
    words = re.findall(r"[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*", text)
    no_space = re.sub(r"\s+", "", text)
    return {
        "总字符数（不含空白）": len(no_space),
        "汉字数": len(chinese),
        "英文单词数": len(words),
        "段落数": len(paragraphs),
        "总行数": len(lines),
    }


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    text = read_text(sys.argv[1])
    print(f"文件：{sys.argv[1]}")
    print("-" * 28)
    for key, value in count(text).items():
        print(f"{key}：{value}")


if __name__ == "__main__":
    main()
