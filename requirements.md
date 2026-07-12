# Character Creator polish

Due to upcoming updates, we need to improve the character creator. as such:

- The Character Creator landing page needs to be replaced with a selector, where "Advent" loads up our new character creator, and "Expert Mode" which leads to the old one.
- the new character creator is a 5 step wizard:
 1. Class selection
 2. Personality and Stat selection
 3. Ability Primer 
 4. Gear Selection
 5. Finishing Touches
- There will be two more modes: Aspiring and Aspirant, which will just change what _options_ the user has, but not what steps

## Summary Panel

All pages should show a Summary of the choices made on the previous page. after confirming/clicking next on a page, the choices are saved to local storage, and if there is a file in local storage, we show a modal on the creation landing page asking if it should be deleted or loaded
 
## Class selection

The class selection should be simple. the top portion should be a single horizontal row of cards that can be scrolled left/right, showing all the options the user has access to. In the Center, there should be a frame around the centermost card, which counts as selected. by deliberately scrolling too far on either end, a random class should be picked with a fitting animation. At page load, a random class should be centered and selected, and a searchbar should allow for quickly finding the class.

Below the slider, we show the current class description, tips etc. 

A new button on the class overview should also open up the wizard at this step.

## Personality and Stat selection

The Personality selection is the topmost box of this site. it shows 3 Selectboxes for the three personality traits. the first two need to be selected from the traits that correspond to two different classes stats, the third one needs to be selected from any other stat not represented by the previous two.

once that is done, stat selection becomes available. A character has a total of 6 stat points, of which some are assigned based on the classes stat spread, at least one is determined by the 3rd personality trait and the remaining may be distributed as the user wishes, so long as no stat does not exceed three points. the Points per stat should be represented with gray boxes, where a filled black box represents a point assigned via class/personality, dark gray means user assigned, light gray with dark gray border means assignable, and dashed gray border means that they cannot be assigned at character creation (i.e. are above the 3 point max)
below that, an unlockable box allows the user to set the character level (default 1) if they wish to import an existing character. each level > 1 adds 2 more spreadable plusses, and characters > 1 can assign up to 5 points into a stat.