# Materials for a manual (Kikiwake)

This zip holds materials for writing a manual, made by Kikiwake from a meeting recording.
Give this zip to an AI (such as Claude) and ask: "Read README.md and write the manual as it describes."
The images show only the part where the screen was shared (the meeting app's participant panel is cut off when it can be told apart), and camera faces are covered with black boxes. Participant names and other things that were on screen (notifications, emails, customer data, etc.) may still remain. Check `frames/` before you share it.

---

## For the AI (1): how to read this zip

The recording is a meeting where someone shared their computer screen and explained an operation or a procedure.
Who said what (the transcript) and the screen that was showing at the time are linked by time.

### Contents

| File | What it holds |
|---|---|
| `timeline.md` | The most important file. Sections in time order, each with its screen image and the remarks made during it |
| `timeline.json` | The same as `timeline.md`, as data (for programs) |
| `transcript.md` | The full transcript (not split into sections) |
| `frames/` | Screen images (JPEG), referenced from `timeline.md` |

### Kinds of sections (headings in timeline.md)

- **Scene change**: much of the text and pictures on the screen changed (another screen or slide, a long scroll, etc.).
  A candidate boundary for a chapter or section of the manual (after a scroll it may still be the same screen; check the image and the remarks)
- **Change within the screen**: only part of the screen changed (a window opened, a menu appeared, something was typed, a range was selected in a table, etc.). A candidate for one step. "What changed" tells where in the image
- **Same screen as before**: the screen went back to an earlier one. Use the image of the section with the number given
- **Brief display**: something shown for a few seconds and gone (such as a notification). No image, so its content is not shown
- **Camera only**: no screen was shared, only cameras. No image; only the remarks

To keep the number of images down, these times are merged into a neighboring section (their time and remarks are kept in that section, not removed):

- While the screen kept moving (scrolling, an AI reply or a page streaming in, etc.) → into the settled screen that follows
- Small changes that moved on to the next screen within 5 seconds → into the next section
- Small changes in the same place one after another (typing into the same field, etc.) → into the section of the last screen ("What changed" covers the whole merged area)
- Changes smaller than 2% of the screen (the mouse pointer moving, the selected cell moving, a hover color, etc.) → not split into a section of their own; they stay part of the same screen.
  Such actions have no image of their own. When the remarks describe one, check the result in the image of the same section (its last screen)

### Notes for reading

- Each image is the last screen of its section (just before the next change). Loading has finished, and the mouse pointer may already be over the next button to press
- The images are cut down to the shared screen (the meeting app's participant panel and the black borders around it were removed). Images where this could not be told apart show the whole recording, and participant names may appear at the edge
- Black boxes in the images cover people seen on camera. Do not guess what is under them
- Images marked "may show a face" may still contain a face, such as a photo
- "On screen for" and the number of remarks under each heading hint at whether the talk was about that screen. They are not proof; check what was said
- Each remark sits in the section that holds its midpoint. Remarks near a change may be about the screen of the neighboring section
- Speaker names are the names given in the transcript ("Speaker A" etc. if none). "Unassigned" means the speaker could not be determined (it may be noise misheard as speech)
- The transcript has recognition errors. When it disagrees with text on screen (button names, field names, screen titles), trust the screen
- When someone says "here", "this screen" or "press this", use the image of the same section to see what they mean

---

## For the AI (2): how to write the manual

Write a procedure manual from these materials.

1. First read `timeline.md` from start to end and understand what the recording explains (the purpose, the screens used, the flow of the steps)
2. Open images from `frames/` when you need them to write a step (you do not have to view them all at once)
3. Organize it like this
   - A title, and what the reader will be able to do (1–2 sentences)
   - Prerequisites (screens, permissions, things to prepare)
   - Steps: numbered, one operation per step. Write screen names, button names and values exactly as shown on screen. Point to a helpful image for each step, like `frames/0003.jpg`
   - Cautions and common mistakes (warnings given during the explanation, answers to questions)
   - FAQ (questions from participants and their answers)
   - Sources: for each step, the section number and time it is based on
4. Please keep to these rules
   - Do not write anything that is not in the materials. Write "(unclear from the recording)" where you do not know
   - If you fill a gap by guessing, make it clear that it is a guess
   - Do not copy personal information shown on screen (email addresses, phone numbers, customer names, meeting participants' names, notification content, etc.) into the manual.
     When a step points to an image that shows such information, add: "(This image shows personal information. Crop or cover it before sharing.)"
   - Leave out small talk and anything unrelated to the procedure
   - If information is missing for a step, list what is missing at the end

Write the output in Markdown, and refer to images by their relative paths under `frames/`.
