#!/usr/bin/env python3
"""Fix the mesh()+add-last-child antipattern in weaponmodels.ts.
Converts:
    mesh(...)
    g.add(g.children[g.children.length - 1])
into:
    g.add(mesh(...))
"""
import re, sys

PATH = '/home/z/my-project/src/game/weaponmodels.ts'
src = open(PATH).read()

# one-line mesh(...) call followed by parent.add(parent.children[parent.children.length - 1])
pat = re.compile(
    r'^([ \t]*)(mesh\((?:[^()\n]|\([^()\n]*\))*\))\n'
    r'[ \t]*([A-Za-z_]\w*)\.add\(\3\.children\[\3\.children\.length - 1\]\)[ \t]*$',
    re.M,
)

def repl(m):
    indent, call, parent = m.group(1), m.group(2), m.group(3)
    return f'{indent}{parent}.add({call})'

out, n = pat.subn(repl, src)
open(PATH, 'w').write(out)
print(f'converted {n} mesh/add pairs')

# report any leftovers
left = re.findall(r'children\.length - 1', out)
print(f'leftover "children.length - 1" references: {len(left)}')
sys.exit(0)
