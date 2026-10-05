You are building a production feature for a web application that converts an uploaded 2D architectural floor-plan image into an editable, interactive 2D floor-plan scene.

I will provide you with an example HTML file that demonstrates approximately what the output should feel like. Use that HTML as a behavioural and visual reference, but do not hard-code its specific floor plan.

# Goal

Implement a feature where a user uploads a floor-plan image such as a JPG, PNG, scan, screenshot, or exported architectural drawing.

The application sends the floor-plan image to the OpenAI API using `gpt-6-sol`.

The model must analyse the image and convert the floor plan into structured scene data containing individually parsed architectural components and furniture.

The frontend must then reconstruct the floor plan from this structured data as interactive objects on a 2D canvas/editor.

The original image must NOT simply be displayed as the editable floor plan.

Every meaningful component should become an individual object.

For example:

- exterior walls
- interior walls
- doors
- windows
- beds
- sofas
- chairs
- tables
- dining tables
- kitchen islands
- kitchen counters
- sinks
- toilets
- bathtubs
- showers
- wardrobes
- closets
- cabinets
- washing machines
- dryers
- stoves
- refrigerators
- desks
- nightstands
- other visible furniture or fixtures

The resulting floor plan should be editable by the user.

---

# Core Architecture

Build the system in two clear layers:

1. AI floor-plan parser
2. Interactive 2D renderer/editor

Do NOT ask GPT to generate HTML, SVG, or Canvas drawing code for every floor plan.

GPT should instead return structured JSON describing the floor plan.

The frontend renderer should be deterministic and reusable for all floor plans.

Conceptually:

Floor-plan image
→ OpenAI vision analysis
→ structured JSON
→ validation/normalisation
→ interactive scene renderer

This separation is important.

---

# OpenAI Integration

Use the OpenAI Responses API.

Use:

`gpt-6-sol`

Send the uploaded floor-plan image as image input along with a strong system/instruction prompt.

The API key must NEVER be exposed in client-side JavaScript.

All OpenAI requests must go through the application's backend/server/API route.

Architecture should resemble:

Frontend
→ `/api/parse-floor-plan`
→ OpenAI Responses API
→ validated JSON
→ frontend

Use environment variables for the API key.

For example:

`OPENAI_API_KEY`

Do not place secret credentials in browser bundles.

---

# AI Parsing Behaviour

The AI should behave like a floor-plan digitisation engine.

Its primary task is geometric reconstruction, not description.

It should inspect:

- exterior boundary
- wall locations
- room boundaries
- room dimensions
- furniture positions
- furniture dimensions
- fixture positions
- door positions
- door widths
- door swing directions when visible
- window positions
- visible architectural labels
- dimension annotations
- overall building dimensions
- relative alignment between objects

The model must return numeric geometry instead of prose whenever possible.

---

# Coordinate System

All parsed geometry must use a consistent floor-plan coordinate system.

Prefer real-world units when the drawing provides enough dimensional information.

Use:

- feet for imperial plans
- metres for metric plans

For example, if the drawing says the building is:

40' × 30'

then set:

```json
{
  "units": "ft",
  "width": 40,
  "height": 30
}
```

All object positions should then use the same coordinate system.

Origin:

- `(0, 0)` = top-left corner of the floor-plan bounding box
- +X = right
- +Y = down

Example:

```json
{
  "x": 5.2,
  "y": 3.1,
  "width": 6.5,
  "height": 3.2
}
```

Do not use raw image pixels as the primary stored coordinate system.

Pixel coordinates may be used internally while parsing, but normalise them into plan-space coordinates.

If no dimensions are visible, use a normalised coordinate system such as:

```text
width = 100
height = imageAspectRatioAdjustedValue
```

and mark:

```json
"scaleConfidence": "unknown"
```

---

# Scale Detection

The parser should try to derive scale from, in priority order:

1. overall exterior dimensions
2. room dimensions
3. multiple dimension annotations
4. known architectural proportions as a fallback

For example, if an image has:

`40'`

across the top boundary and:

`30'`

along the side,

use those dimensions to map image-space geometry into plan-space coordinates.

Never invent exact dimensions when they cannot reasonably be inferred.

Store confidence values for inferred data.

---

# Scene Data Schema

Design a TypeScript interface/schema similar to this.

```ts
interface FloorPlan {
  id: string;

  units: "ft" | "m" | "normalized";

  width: number;
  height: number;

  sourceImage?: {
    width: number;
    height: number;
  };

  scaleConfidence: number;

  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  windows: Window[];
  furniture: Furniture[];
  fixtures: Fixture[];
}
```

---

# Wall Schema

Walls must be separate objects.

Prefer representing walls as line segments with thickness instead of generic rectangles.

```ts
interface Wall {
  id: string;

  type: "wall";

  x1: number;
  y1: number;

  x2: number;
  y2: number;

  thickness: number;

  exterior: boolean;

  confidence: number;
}
```

The parser should preserve individual wall segments.

Do not merge the entire building perimeter into one giant polygon if that makes editing difficult.

Users should eventually be able to select or edit individual walls.

---

# Door Schema

```ts
interface Door {
  id: string;

  type: "door";

  x: number;
  y: number;

  width: number;

  rotation: number;

  swing?: "left" | "right" | "double" | "sliding" | "unknown";

  wallId?: string;

  confidence: number;
}
```

Render doors approximately using architectural conventions where practical.

A simple line + arc representation is sufficient.

---

# Window Schema

```ts
interface Window {
  id: string;

  type: "window";

  x: number;
  y: number;

  width: number;

  rotation: number;

  wallId?: string;

  confidence: number;
}
```

Windows should remain individually selectable.

---

# Furniture Schema

Every furniture item must be a separate object.

```ts
interface Furniture {
  id: string;

  type: "furniture";

  furnitureType:
    | "bed"
    | "sofa"
    | "chair"
    | "armchair"
    | "table"
    | "coffee_table"
    | "dining_table"
    | "desk"
    | "nightstand"
    | "wardrobe"
    | "cabinet"
    | "kitchen_island"
    | "unknown";

  label: string;

  x: number;
  y: number;

  width: number;
  height: number;

  rotation: number;

  confidence: number;
}
```

Each item must preserve the approximate width-to-height ratio visible in the source floor plan.

DO NOT render every furniture item as the same-size rectangle.

If a bed in the source is approximately twice as long as it is wide, the interactive rectangle must preserve approximately that ratio.

---

# Fixture Schema

```ts
interface Fixture {
  id: string;

  type: "fixture";

  fixtureType:
    | "sink"
    | "toilet"
    | "bathtub"
    | "shower"
    | "stove"
    | "oven"
    | "refrigerator"
    | "washer"
    | "dryer"
    | "counter"
    | "unknown";

  label: string;

  x: number;
  y: number;

  width: number;
  height: number;

  rotation: number;

  confidence: number;
}
```

Kitchen and bathroom fixtures should NOT be ignored simply because they are small.

---

# Room Schema

Rooms are useful for metadata and room-level interactions.

```ts
interface Room {
  id: string;

  name: string;

  polygon: Array<{
    x: number;
    y: number;
  }>;

  labelPosition?: {
    x: number;
    y: number;
  };

  statedDimensions?: {
    width?: number;
    height?: number;
  };

  confidence: number;
}
```

Examples:

- Master Bedroom
- Bedroom 2
- Bedroom 3
- Kitchen
- Dining Area
- Family Room
- Bathroom
- Laundry
- Closet

Do not require the room polygon to be perfect if the plan is ambiguous.

---

# OpenAI Output

Use structured output / schema validation if supported by the application's OpenAI integration.

The AI response must contain JSON only.

Do NOT allow responses like:

"The image appears to contain three bedrooms..."

That information needs to be expressed structurally.

Example response:

```json
{
  "units": "ft",
  "width": 40,
  "height": 30,
  "scaleConfidence": 0.97,
  "rooms": [],
  "walls": [],
  "doors": [],
  "windows": [],
  "furniture": [],
  "fixtures": []
}
```

Validate the returned object server-side before returning it to the frontend.

If individual invalid objects exist, either repair them or discard only those objects instead of failing the entire plan where possible.

---

# AI System Prompt

Use an instruction conceptually similar to this for the OpenAI call:

"You are an architectural floor-plan digitisation engine.

Analyse the supplied floor-plan image and reconstruct its editable 2D geometry.

Your job is not to describe the image. Your job is to convert every meaningful architectural component into structured geometry.

Detect the exterior boundary, interior walls, doors, windows, rooms, furniture, appliances, plumbing fixtures, counters, cabinets and other visible floor-plan objects.

Preserve relative position, orientation and size.

When explicit measurements are visible, use them to derive a real-world coordinate system.

All returned objects must use the same coordinate system.

Use the top-left of the building footprint as origin (0,0), with X increasing to the right and Y increasing downward.

Furniture and fixtures must preserve approximately the same aspect ratio as shown in the floor plan.

A bed, sofa, table, sink or other object must not be reduced to an arbitrary generic square.

Walls should be represented as editable line segments with thickness.

Doors and windows must be represented independently rather than baked into wall graphics.

Do not include dimension arrows, annotation lines, decorative text or the 'FLOOR PLAN' title as physical objects.

Room labels should become room metadata.

If an object is uncertain, include it with a lower confidence score rather than pretending certainty.

Do not invent components that are not visually supported.

Return only data conforming to the supplied schema."

---

# Parsing Accuracy

Accuracy of relative geometry is more important than visual beauty.

Prioritise:

1. wall topology
2. exterior dimensions
3. room boundaries
4. door locations
5. window locations
6. large furniture
7. kitchen/bathroom fixtures
8. smaller objects

The reconstructed layout should visually align with the source image when overlaid.

---

# Interactive Editor

Render the parsed scene using a proper interactive 2D layer.

Use the existing project's framework and dependencies where sensible.

Suitable choices include:

- HTML Canvas
- Konva.js
- Fabric.js
- PixiJS
- SVG with appropriate interaction handling

If the project already has a suitable rendering library, prefer it rather than adding unnecessary dependencies.

The example HTML file I provide should guide the intended behaviour.

---

# Required Interactions

At minimum implement:

## Selection

Clicking an object selects it.

Selected objects should have a clearly visible selection state.

For example:

- outline
- bounding box
- handles
- different stroke

Only one object needs to be selected initially, although architecture should not prevent future multi-select.

---

## Dragging

Furniture and fixtures must be draggable.

When dragged:

- update scene coordinates
- update rendering immediately
- maintain exact object dimensions
- do not rasterise the object

Walls may also be draggable if reasonably implemented.

---

## Rotation

Furniture should support rotation.

At minimum support:

- rotation handle
or
- property inspector numeric rotation

Store rotation in degrees.

---

## Resize

Furniture and fixtures should be resizable.

Preserve the new dimensions in state.

Optional modifier:

Shift = lock aspect ratio.

Walls should eventually support endpoint editing.

---

# Labels

Render a readable label above or inside furniture rectangles.

Examples:

```text
BED
SOFA
DINING TABLE
SINK
WASHER
TOILET
```

Labels should scale sensibly with zoom.

Do not allow labels to dominate small objects.

For very small objects, hide the label below a zoom threshold if necessary.

---

# Furniture Rendering

For the first implementation, simple schematic rendering is preferred over detailed icons.

Furniture can be represented as:

- rectangle
- thin border
- text label

For example:

```text
┌───────────────┐
│      BED      │
│               │
└───────────────┘
```

The most important requirement is preserving geometry.

Do not spend excessive effort drawing realistic bed pillows, sofa cushions, appliances, etc.

The editor should have a clean architectural / CAD-like appearance.

---

# Walls

Render walls visually differently from furniture.

Suggested styling:

- dark fill/stroke
- noticeably thicker than furniture borders
- no label by default

Interior and exterior walls may have different thicknesses if the parser identifies them.

---

# Canvas Features

Implement:

- pan
- zoom
- reset view
- fit-to-screen

Mouse wheel / trackpad should zoom naturally.

Zoom should be centred near the pointer where practical.

The user should be able to move around a large floor plan comfortably.

---

# Layer Controls

Create basic layer visibility controls for:

- rooms
- walls
- doors
- windows
- furniture
- fixtures
- labels
- original reference image

The reference image layer is particularly useful.

---

# Reference Image Overlay

Keep the original image available as an optional background/reference layer.

This is for visual verification only.

The parsed objects remain independently editable.

Add:

- Show source image toggle
- opacity slider

For example:

```text
Reference image opacity: 0–100%
```

This allows the user to compare AI reconstruction against the original drawing.

The source image should align with the reconstructed plan coordinate system as closely as possible.

---

# State Management

Maintain the floor-plan representation as structured application state.

Do not treat rendered canvas state as the source of truth.

Conceptually:

```ts
floorPlanData
    ↓
renderer
```

Object modifications update `floorPlanData`.

This will make future features easier, including:

- undo/redo
- persistence
- 3D conversion
- collaboration
- measurement tools
- snapping

---

# Object IDs

Every object must have a stable unique ID.

Examples:

```text
wall_001
wall_002
bed_001
sink_001
door_003
window_004
```

Do not use array indexes as persistent IDs.

---

# Inspector

When an object is selected, show a small properties panel.

At minimum:

```text
Type
Label
X
Y
Width
Height
Rotation
Confidence
```

For walls:

```text
X1
Y1
X2
Y2
Thickness
Length
```

Editing numeric values should update the object.

---

# Undo / Redo

Implement basic undo and redo.

Actions that should be reversible include:

- drag
- resize
- rotation
- delete
- property edits

Keyboard shortcuts:

```text
Ctrl/Cmd + Z
Ctrl/Cmd + Shift + Z
```

---

# Delete

Allow the selected object to be deleted using:

- Delete
- Backspace

Avoid deleting an object while the user is typing into an input field.

---

# JSON Export

Provide:

`Export JSON`

Download the current floor-plan scene as JSON.

The exported JSON should follow the same canonical schema used internally.

This export will eventually feed downstream features such as 3D generation.

---

# JSON Import

Also support importing previously exported floor-plan JSON.

This is important for testing and persistence.

---

# Saving

Structure the code so floor plans can later be persisted to the application database.

Do not tightly couple the editor to local browser state.

Use a serialisable model.

---

# Loading UX

Floor-plan analysis may take time.

When parsing:

show a proper state such as:

```text
Analysing floor plan…
Detecting walls, furniture and fixtures…
```

Do not freeze the UI.

Handle API errors gracefully.

---

# Low Confidence Objects

Objects returned with low confidence should still render but may optionally display a warning indicator.

Example:

```text
confidence < 0.5
```

→ dotted outline or warning symbol.

Do not automatically hide uncertain objects.

The user should be able to correct them.

---

# Validation / Normalisation

After receiving AI JSON, run a normalisation layer.

Check:

- numeric values are finite
- widths > 0
- heights > 0
- IDs exist
- coordinates are within reasonable plan bounds
- rotations are normalised
- wall endpoints are valid
- unknown categories map to `unknown`

Clamp obviously invalid coordinates only when safe.

Do not silently distort valid geometry.

---

# Important Geometry Rule

Do NOT separately estimate every object's real-world size if a global scale has already been established.

Instead:

1. detect the global plan scale
2. detect object bounding boxes in image coordinates
3. convert those bounding boxes consistently into plan coordinates

This prevents objects from becoming mutually inconsistent.

---

# Prompt Robustness

The feature should work with floor plans that vary significantly in style:

- black and white plans
- coloured plans
- scanned blueprints
- screenshots
- plans with furniture
- plans without furniture
- metric dimensions
- imperial dimensions
- thick or thin wall styles
- architectural symbols
- irregular building footprints

Do not write parser logic that only works for the supplied example image.

The supplied example is merely a reference.

---

# No Hallucinated Precision

Do not pretend that the model can always infer exact architecture.

Where measurements are not present, geometry is approximate.

Confidence metadata should communicate this.

For example:

```json
{
  "width": 5.43,
  "confidence": 0.62
}
```

is preferable to pretending the width was explicitly measured.

---

# Future Compatibility

Design the scene model so it can later support:

- wall snapping
- room generation
- dimension tools
- furniture library replacement
- floor material
- multiple floors
- stairs
- balconies
- columns
- 3D extrusion
- wall height
- BIM-like metadata

Do not implement all of these now.

Just avoid architectural decisions that make them difficult later.

---

# Code Organisation

Keep the feature modular.

A reasonable structure might resemble:

```text
floor-plan/
  components/
    FloorPlanEditor
    FloorPlanCanvas
    FloorPlanToolbar
    LayerPanel
    PropertyInspector

  renderer/
    renderWall
    renderDoor
    renderWindow
    renderFurniture
    renderFixture

  api/
    parseFloorPlan

  schemas/
    floorPlanSchema

  utils/
    coordinates
    normaliseFloorPlan
    geometry

  types/
    floorPlan.ts
```

Adapt this to the existing application's conventions.

Do not reorganise unrelated application code.

---

# API Endpoint

Implement a backend endpoint similar to:

```text
POST /api/parse-floor-plan
```

Input:

```text
multipart/form-data
image=<uploaded image>
```

or whichever upload mechanism is consistent with the existing app.

Server workflow:

```text
receive image
→ validate type/size
→ send image + parser instructions to OpenAI
→ receive structured output
→ validate
→ normalise
→ return FloorPlan JSON
```

---

# Error Handling

Handle:

- unsupported image
- file too large
- OpenAI API error
- malformed model response
- incomplete geometry
- no floor plan detected

Return clear errors.

Example:

```json
{
  "error": "Could not detect a valid floor plan in this image."
}
```

Do not expose OpenAI API stack traces or credentials to the frontend.

---

# Original Image

Store enough metadata to maintain correspondence between image coordinates and plan coordinates.

This is important for the reference-image overlay and debugging.

For example:

```ts
sourceTransform: {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}
```

If GPT identifies that the actual floor-plan drawing occupies only part of the uploaded image, the system should account for this.

---

# Source Image Cropping

Floor-plan images often contain:

- whitespace
- title blocks
- dimension arrows
- legends
- drawing titles

The parser should determine the actual physical-plan bounding box.

For example, in the supplied reference image, the text:

`FLOOR PLAN`

below the building is not part of the building footprint.

Likewise, dimension lines outside the walls are annotations, not walls.

Exclude these areas from physical geometry.

---

# Objects vs Annotation

Never create physical objects for:

- room text
- dimension arrows
- dimension text
- drawing title
- decorative annotations
- leader lines

Instead parse useful information from them.

Example:

`BEDROOM #2 9'-0" × 12'-0"`

should produce room metadata, not a text rectangle.

---

# Testing

Test the implementation using the example floor-plan image and HTML file I supply.

For the example, the reconstructed scene should clearly identify at least:

- exterior walls
- interior bedroom walls
- bathroom walls
- closet/laundry walls
- three beds
- nightstands
- sofa
- chairs
- coffee table
- dining table
- kitchen island
- kitchen counters
- stove
- kitchen sink
- bathtub
- toilet
- bathroom sink
- washer
- dryer
- doors
- windows

Furniture should approximately match the positions and proportions visible in the source.

Do NOT manually hard-code these objects just to pass the example.

They must originate from the general AI parsing pipeline.

---

# Evaluation

When reviewing the result, prioritise these criteria:

### 1. Structural accuracy

Does the reconstructed wall layout resemble the image?

### 2. Object completeness

Were most meaningful furniture and fixtures detected?

### 3. Relative geometry

Are object position, size, orientation and aspect ratios approximately correct?

### 4. Editability

Can each item be selected and manipulated independently?

### 5. Reusability

Does the system work with arbitrary uploaded floor plans rather than only the sample?

### 6. Data quality

Is the scene represented cleanly as structured JSON suitable for downstream use?

---

# Important Constraints

DO:

- parse the image using multimodal AI
- output structured JSON
- make every meaningful component independent
- preserve proportions
- preserve relative positions
- use real-world dimensions where available
- keep the source image as an optional reference overlay
- use a deterministic frontend renderer
- keep OpenAI calls server-side

DO NOT:

- return a generated floor-plan image
- ask GPT to regenerate the scene visually
- rasterise the parsed result
- send OpenAI API keys to the browser
- represent all furniture with arbitrary same-sized rectangles
- treat the entire floor plan as one giant object
- hard-code the supplied example
- parse labels as furniture
- confuse dimension lines with walls

---

# Deliverable

Implement the complete first working version of this feature in the existing web app.

Before coding:

1. inspect the existing repository
2. identify its framework, state-management approach and UI conventions
3. inspect the example HTML I provide
4. reuse appropriate existing project components/dependencies
5. avoid unnecessary architectural rewrites

Then implement the smallest clean architecture that satisfies the requirements above.

After implementation:

1. run the application
2. test an upload using the supplied example floor-plan image
3. verify the OpenAI response
4. verify that parsed objects appear independently
5. verify dragging
6. verify resizing/rotation
7. verify zoom/pan
8. verify source-image overlay
9. verify JSON export/import
10. fix obvious parsing/rendering errors

Do not stop after merely creating API scaffolding.

The feature is complete only when an uploaded floor-plan image can actually be parsed and reconstructed as an editable 2D scene in the browser.