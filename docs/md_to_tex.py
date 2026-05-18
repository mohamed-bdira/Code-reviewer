#!/usr/bin/env python3
"""Heuristic Markdown -> LaTeX for PFE_Report_HMIDA_Structure_EN.md (run from PFE/docs)."""

from __future__ import annotations

import re
from pathlib import Path

MD_PATH = Path(__file__).with_name("PFE_Report_HMIDA_Structure_EN.md")
OUT_PATH = Path(__file__).with_name("PFE_Report_HMIDA_Structure_EN.tex")

HEADER = r"""\documentclass[11pt,a4paper]{report}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{longtable}
\usepackage{hyperref}
\usepackage{xcolor}
\usepackage{caption}
\hypersetup{colorlinks=true, breaklinks=true,
  linkcolor=blue, urlcolor=blue, citecolor=blue}
\usepackage{listings}
\lstdefinestyle{mdiag}{basicstyle=\ttfamily\footnotesize,breaklines=true,frame=single,
  backgroundcolor=\color{gray!10}}
\lstset{style=mdiag}
\newcommand{\ph}[1]{\textit{\textcolor{gray}{#1}}}

\begin{document}

\begin{titlepage}
\centering\vspace*{2cm}
{\Large\bfseries Final Year Project Report\par}
\vspace{0.75cm}
{\LARGE\bfseries AI-Assisted GitHub Pull Request Review Platform\par}
\vspace{2cm}
\begin{tabular}{rl}
Working title: & \ph{Insert official title} \\
Author: & \ph{Your full name} \\
Supervisor: & \ph{Supervisor} \\
Institution: & \ph{University} \\
Host org.: & \ph{Company} \\
Degree: & \ph{Program} \\
Period: & \ph{Academic year} \\
\end{tabular}
\vfill
\end{titlepage}

\pagenumbering{roman}
\tableofcontents
\listoffigures
\listoftables
\clearpage
\pagenumbering{arabic}

"""

FOOTER = "\n\\end{document}\n"

SPEC_MAP = {
    "\\": r"\textbackslash{}",
    "{": r"\{",
    "}": r"\}",
    "$": r"\$",
    "&": r"\&",
    "#": r"\#",
    "_": r"\_",
    "%": r"\%",
    "^": r"\textasciicircum{}",
    "~": r"\textasciitilde{}",
}


def esc(s: str) -> str:
    out: list[str] = []
    for ch in s:
        out.append(SPEC_MAP.get(ch, ch))
    return "".join(out)


def fmt_inline(s: str) -> str:
    s = re.sub(r"`([^`]+)`", lambda m: r"\texttt{" + esc(m.group(1)) + "}", s)
    s = re.sub(r"\*\*([^*]+)\*\*", lambda m: r"\textbf{" + m.group(1) + "}", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", lambda m: r"\textit{" + m.group(1) + "}", s)

    def _url(m):
        return r"\url{" + m.group(1) + "}"

    s = re.sub(r"(https?://[^\s\)\]>]+)", _url, s)
    return s


def simple_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    o = [
        r"\begingroup\small",
        r"\begin{tabular}{@{}p{0.28\textwidth}p{0.62\textwidth}@{}}",
        r"\toprule",
    ]
    for i, row in enumerate(rows):
        row = row + ["", ""]
        o.append(fmt_inline(row[0]) + " & " + fmt_inline(row[1]) + r" \\")
        if i == 0:
            o.append(r"\midrule")
    o.extend([r"\bottomrule", r"\end{tabular}", r"\endgroup", ""])
    return "\n".join(o) + "\n"


def emit_acronyms(lines: list[str], start: int) -> tuple[str, int]:
    rows: list[list[str]] = []
    i = start
    while i < len(lines):
        ln = lines[i]
        if ln.strip() == "---" or re.match(r"^#\s+", ln):
            break
        if ln.strip().startswith("|") and "|" in ln[2:]:
            parts = [p.strip() for p in ln.strip().strip("|").split("|")]
            if len(parts) >= 2 and parts[0] and not parts[0].startswith("-"):
                rows.append(parts[:2])
        i += 1
    t = [r"\chapter*{List of Acronyms}", r"\addcontentsline{toc}{chapter}{List of Acronyms}"]
    for abbr, df in rows[1:]:  # skip header
        if abbr.replace("-", "").strip() == "":
            continue
        if abbr.strip() == "Acronym":
            continue
        t.append(r"\noindent\textbf{" + esc(abbr) + r"} --- " + fmt_inline(df) + r"\par\smallskip")
    return "\n".join(t) + "\n\n", i


def extract_acronyms_tex(lines: list[str]) -> str:
    for i, ln in enumerate(lines):
        if ln.startswith("## List of Acronyms"):
            tex, _ = emit_acronyms(lines, i + 1)
            return tex
    return ""


def body_start(lines: list[str]) -> int:
    for i, ln in enumerate(lines):
        if ln.startswith("# General Introduction"):
            return i
    return 0


def main() -> None:
    raw = MD_PATH.read_text(encoding="utf-8").splitlines()
    acro = extract_acronyms_tex(raw)
    start = body_start(raw)
    lines = raw[start:]
    parts: list[str] = [HEADER]
    if acro:
        parts.append(acro)
    i = 0
    in_fence = False
    fence: list[str] = []
    cap_for_listing = "Listing"

    while i < len(lines):
        s = lines[i].rstrip()

        if "<!--" in s:
            j = s.find("-->")
            parts.append("% " + (s.replace("<!--", "").replace("-->", "").strip() if j != -1 else s) + "\n")
            i += 1
            continue

        if s.startswith("```"):
            if not in_fence:
                in_fence = True
                fence = []
            else:
                in_fence = False
                parts.append("\\begin{lstlisting}[caption={" + esc(cap_for_listing[:180]) + "}]\n")
                parts.append("\n".join(esc(x) for x in fence))
                parts.append("\n\\end{lstlisting}\n\n")
            i += 1
            continue

        if in_fence:
            fence.append(s)
            i += 1
            continue

        if s.startswith("# Final Year Project Report"):
            while i + 1 < len(lines) and lines[i + 1].strip() and not lines[i + 1].startswith("#"):
                i += 1
            i += 1
            continue

        if s == "---":
            i += 1
            continue

        if s.startswith("# "):
            title = s[2:].strip()
            if title == "General Introduction":
                parts += ["\\chapter*{General Introduction}\n", "\\addcontentsline{toc}{chapter}{General Introduction}\n\n"]
            elif title == "General Conclusion":
                parts += ["\\chapter*{General Conclusion}\n", "\\addcontentsline{toc}{chapter}{General Conclusion}\n\n"]
            elif title == "Bibliography":
                parts.append("\\begin{thebibliography}{99}\n")
                i += 1
                bib_n = 1
                while i < len(lines):
                    ln = lines[i].strip()
                    if ln == "---" or (ln.startswith("# ") and "Bibliography" not in ln):
                        break
                    if re.match(r"^\d+\.", ln):
                        txt = re.sub(r"^\d+\.\s*", "", ln)
                        parts.append("\\bibitem{kb" + str(bib_n) + "}" + fmt_inline(txt) + "\n\n")
                        bib_n += 1
                    i += 1
                parts.append("\\end{thebibliography}\n\n")
                continue
            else:
                parts.append("\\chapter{" + esc(title) + "}\n\n")
            i += 1
            continue

        if s.startswith("## "):
            parts.append("\\section{" + esc(s[3:].strip()) + "}\n\n")
            i += 1
            continue

        if s.startswith("### "):
            parts.append("\\subsection{" + esc(s[4:].strip()) + "}\n\n")
            i += 1
            continue

        if s.startswith("**Figure "):
            cap_raw = s.replace("**", "").strip()
            cap_for_listing = cap_raw
            cap_short = cap_raw.split(":", 1)[-1].strip() if ":" in cap_raw else cap_raw
            parts += [
                "\\begin{figure}[htbp]\\centering\n",
                "\\fbox{\\parbox{0.88\\textwidth}{\\centering\\vspace{1.2cm}"
                "\\ph{Insert diagram (Mermaid export)}\\vspace{0.4cm}\\\\\n\\small ",
                fmt_inline(cap_raw),
                "\n\\vspace{1.2cm}}}\n",
                "\\caption{" + fmt_inline(cap_short) + "}\n",
                "\\end{figure}\n\n",
            ]
            i += 1
            continue

        if s.startswith("|") and s.count("|") >= 2:
            rows: list[list[str]] = []
            j = i
            while j < len(lines) and lines[j].strip().startswith("|"):
                rl = lines[j].strip()
                if re.match(r"^\|?[\s\-:|]+\|?$", rl):
                    j += 1
                    continue
                rows.append([c.strip() for c in rl.strip("|").split("|")])
                j += 1
            parts.append(simple_table(rows))
            i = j
            continue

        if s.startswith("* ") or s.startswith("- "):
            items: list[str] = []
            while i < len(lines) and lines[i].strip().startswith(("* ", "- ")):
                items.append("\\item " + fmt_inline(lines[i].strip()[2:]))
                i += 1
            parts.append("\\begin{itemize}\n" + "\n".join(items) + "\n\\end{itemize}\n\n")
            continue

        mnum = re.match(r"^(\d+)\.\s+(.*)", s)
        if mnum:
            items: list[str] = []
            while i < len(lines):
                mm = re.match(r"^(\d+)\.\s+(.*)", lines[i].strip())
                if not mm:
                    break
                items.append("\\item " + fmt_inline(mm.group(2)))
                i += 1
            parts.append("\\begin{enumerate}\n" + "\n".join(items) + "\n\\end{enumerate}\n\n")
            continue

        if not s:
            parts.append("\n")
            i += 1
            continue

        if "*End of draft*" in s:
            i += 1
            continue

        parts.append(fmt_inline(s) + "\n\n")
        i += 1

    body = "".join(parts)
    OUT_PATH.write_text(body + FOOTER, encoding="utf-8")
    print("Wrote", OUT_PATH)


if __name__ == "__main__":
    main()
