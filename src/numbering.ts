import { Editor, EditorChange, EditorRange, HeadingCache } from 'obsidian'
import { ViewInfo } from './activeViewHelpers'
import { doesContentsHaveValue, NumberHeadingsPluginSettings } from './settingsTypes'

const TOC_LIST_ITEM_BULLET = '-'

function makeHeadingHashString (editor: Editor, heading: HeadingCache): string | undefined {
  const regex = /^\s{0,4}#+/g
  const headingLineString = editor.getLine(heading.position.start.line)
  if (!headingLineString) return undefined

  const matches = headingLineString.match(regex)
  if (!matches) return undefined

  if (matches.length !== 1) {
    // eslint-disable-next-line no-console
    console.log("Unexpected heading format: '" + headingLineString + "'")
    return undefined
  }

  const match = matches[0]
  return match.trimLeft()
}

function makeNumberingString (numberingStack: NumberingToken[]): string {
  let numberingString = ''

  for (let i = 0; i < numberingStack.length; i++) {
    if (i === 0) {
      numberingString += ' '
    } else {
      numberingString += '.'
    }
    numberingString += numberingStack[i].toString()
  }

  return numberingString
}

function getHeadingPrefixRange (editor: Editor, heading: HeadingCache): EditorRange | undefined {
  const regex = /^\s{0,4}#+( )?([0-9]+\.|[A-Z]\.)*([0-9]+|[A-Z])?[:.-]?( )+/g
  const headingLineString = editor.getLine(heading.position.start.line)
  if (!headingLineString) return undefined

  const matches = headingLineString.match(regex)

  if (matches && matches.length !== 1) {
    // eslint-disable-next-line no-console
    console.log("Unexpected heading format: '" + headingLineString + "'")
    return undefined
  }

  const match = matches ? matches[0] : ''

  const from = {
    line: heading.position.start.line,
    ch: 0
  }
  const to = {
    line: heading.position.start.line,
    ch: match.length
  }

  return { from, to }
}

type NumberingToken = string | number

function zerothNumberingTokenInStyle (style: string): NumberingToken {
  if (style === '1') {
    return 0
  } else if (style === 'A') {
    return 'Z'
  }

  return 0
}

function firstNumberingTokenInStyle (style: string): NumberingToken {
  if (style === '1') {
    return 1
  } else if (style === 'A') {
    return 'A'
  }

  return 1
}

function nextNumberingToken (t: NumberingToken): NumberingToken {
  if (typeof t === 'number') {
    return t + 1
  }

  if (typeof t === 'string') {
    if (t === 'Z') return 'A'
    else return String.fromCharCode(t.charCodeAt(0) + 1)
  }

  return 1
}

function cleanHeadingTextForToc (htext: string): string {
  if (htext.contains('^')) {
    const x = htext.split('^')
    if (x.length > 1) {
      return x[0].trim()
    }
  }
  return htext.trim()
}

function createTocEntry (h: HeadingCache, settings: NumberHeadingsPluginSettings):string {
  const text = h.heading
  const cleanText = cleanHeadingTextForToc(text)

  let bulletIndent = ''
  const startLevel = settings.skipTopLevel ? 2 : 1
  for (let i = startLevel; i < h.level; i++) {
    bulletIndent += '\t'
  }

  const entryLink = `[[#${text}|${cleanText}]]`

  return bulletIndent + TOC_LIST_ITEM_BULLET + ' ' + entryLink
}

// Replace a range, but only if there is a change in text, to prevent poluting the undo stack
function replaceRangeSafely (editor: Editor, changes: EditorChange[], range: EditorRange, text: string): void {
  const previousText = editor.getRange(range.from, range.to)

  if (previousText !== text) {
    changes.push({
      text: text,
      from: range.from,
      to: range.to
    })
  }
}

export const updateHeadingNumbering = (
  viewInfo: ViewInfo | undefined,
  settings: NumberHeadingsPluginSettings
): void => {
  if (!viewInfo) return
  const headings = viewInfo.data.headings ?? []
  const editor = viewInfo.editor

  let previousLevel = 1

  const numberingStack: NumberingToken[] = [zerothNumberingTokenInStyle(settings.styleLevel1)]

  if (settings.skipTopLevel) {
    previousLevel = 2
  }

  const changes: EditorChange[] = []

  for (const heading of headings) {
    // Update the numbering stack based on the level and previous level

    const level = heading.level

    // Remove any heading numbers in these two cases:
    // 1. this is a top level and we are skipping top level headings
    // 2. this level is higher than the max level setting
    if ((settings.skipTopLevel && level === 1) || (level > settings.maxLevel)) {
      const prefixRange = getHeadingPrefixRange(editor, heading)

      if (prefixRange) {
        const headingHashString = makeHeadingHashString(editor, heading)
        if (headingHashString === undefined) continue
        replaceRangeSafely(editor, changes, prefixRange, headingHashString + ' ')
      }
      continue
    }

    // Adjust numbering stack
    if (level === previousLevel) {
      const x = numberingStack.pop()
      if (x !== undefined) {
        numberingStack.push(nextNumberingToken(x))
      }
    } else if (level < previousLevel) {
      for (let i = previousLevel; i > level; i--) {
        numberingStack.pop()
      }
      const x = numberingStack.pop()
      if (x !== undefined) {
        numberingStack.push(nextNumberingToken(x))
      }
    } else if (level > previousLevel) {
      for (let i = previousLevel; i < level; i++) {
        numberingStack.push(firstNumberingTokenInStyle(settings.styleLevelOther))
      }
    }

    // Set the previous level to this level for the next iteration
    previousLevel = level

    if (level > settings.maxLevel) {
      // If we are above the max level, just don't number it
      continue
    }

    // Find the range to replace, and then do it
    const prefixRange = getHeadingPrefixRange(editor, heading)
    if (prefixRange === undefined) return
    const headingHashString = makeHeadingHashString(editor, heading)
    if (headingHashString === undefined) return
    const prefixString = makeNumberingString(numberingStack)
    replaceRangeSafely(editor, changes, prefixRange, headingHashString + prefixString + settings.separator + ' ')
  }

  // Execute the transaction to make all the changes at once
  if (changes.length > 0) {
    // eslint-disable-next-line no-console
    console.log('Number Headings Plugin: Applying headings numbering changes:', changes.length)
    editor.transaction({
      changes: changes
    })
  }
}

export const updateTableOfContents = (
  viewInfo: ViewInfo | undefined,
  settings: NumberHeadingsPluginSettings
): void => {
  if (!viewInfo) return
  const headings = viewInfo.data.headings ?? []
  const editor = viewInfo.editor

  if (!doesContentsHaveValue(settings.contents)) return

  let tocHeading: HeadingCache | undefined
  let tocBuilder = '\n'
  const changes: EditorChange[] = []

  for (const heading of headings) {
    // ORDERING: Important to find the TOC heading before skipping skipped headings, since that is for numbering

    // Find the TOC heading
    if (heading.heading.endsWith(settings.contents)) {
      tocHeading = heading
    }

    if ((settings.skipTopLevel && heading.level === 1) || (heading.level > settings.maxLevel)) {
      continue
    }

    const tocEntry = createTocEntry(heading, settings)
    tocBuilder += tocEntry + '\n'
  }

  // Insert the generated table of contents
  if (tocHeading) {
    const from = {
      line: tocHeading.position.start.line + 1,
      ch: 0
    }

    const startingLine = tocHeading.position.start.line + 1
    let endingLine = 0
    let foundList = false
    for (endingLine = startingLine; ; endingLine++) {
      const line = editor.getLine(endingLine)
      if (line === undefined) {
        // Reached end of file, insert at the start of the TOC section
        endingLine = startingLine
        break
      }
      const trimmedLineText = line.trimStart()
      if (foundList) {
        if (!trimmedLineText.startsWith(TOC_LIST_ITEM_BULLET)) break
        if (trimmedLineText.startsWith('#')) break
      } else {
        if (trimmedLineText.startsWith(TOC_LIST_ITEM_BULLET)) {
          foundList = true
        } else if (trimmedLineText.startsWith('#')) {
          // Reached the next heading without finding existing TOC list, insert at the start of the TOC section
          endingLine = startingLine
          break
        } else {
          continue
        }
      }
    }

    const to = {
      line: endingLine,
      ch: 0
    }
    const range = { from, to }
    console.log('replacing range for TOC: ', from, to)

    if (tocBuilder === '\n') {
      tocBuilder = ''
    }
    replaceRangeSafely(editor, changes, range, tocBuilder)

    // FIXME:
    // - MAke sure the headings reflect the headings after numbers are added, by inserting the TOC as a second transaction after the first
    // - exclude number of table of contents
  }

  // Execute the transaction to make all the changes at once
  if (changes.length > 0) {
    // eslint-disable-next-line no-console
    console.log('Number Headings Plugin: Applying table of contents changes:', changes.length)
    editor.transaction({
      changes: changes
    })
  }
}

export const removeHeadingNumbering = (
  viewInfo: ViewInfo | undefined
): void => {
  if (!viewInfo) return
  const headings = viewInfo.data.headings ?? []
  const editor = viewInfo.editor

  const changes: EditorChange[] = []

  for (const heading of headings) {
    const prefixRange = getHeadingPrefixRange(editor, heading)
    if (prefixRange === undefined) return
    const headingHashString = makeHeadingHashString(editor, heading)
    if (headingHashString === undefined) return
    replaceRangeSafely(editor, changes, prefixRange, headingHashString + ' ')
  }

  if (changes.length > 0) {
    editor.transaction({
      changes: changes
    })
  }
}
