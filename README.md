# IFC Edit

A browser-based IFC toolkit for inspecting models, batch-editing single-value
properties, and producing traceable rule-based cost estimates.

## Current tools

- **IFC Viewer** — load an IFC model, inspect elements and properties, filter
  model visibility, and export edited IFC data.
- **Property Batch Editor** — filter `IfcPropertySingleValue` rows, apply one
  value to the matching properties, and download the edited model.
- **Cost Calculator** — select one pricing basis per element, apply IFC model
  rates or reusable rate-library rules, map classifications such as Uniformat
  to DIN 276, filter the linked 3D model, compare revisions, and export CSV.

Rate rules and classification mappings are stored in browser local storage and
can also be imported or exported as JSON.

## Run locally

Requires a current Node.js installation.

```sh
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Quality checks

```sh
npm test
npm run lint
npm run build
```

The production build currently includes the Three.js and IFC parsing stack in
the main bundle, so Vite may report a large-chunk warning.

## Roadmap

See [WAYTOGOAL.md](./WAYTOGOAL.md).
