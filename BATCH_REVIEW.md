# Batch Review Feature - Complete Implementation

## 🎉 Feature Successfully Implemented

A modern, main-pane **Batch Review** feature has been added to VSCode-Gerrit, allowing users to review multiple Gerrit changes at once with batch voting capabilities.

## 📋 What Was Built

### Main Components

1. **Backend Provider** (`src/views/editor/batchReview.ts`)
   - Opens batch review panel in main editor area (not sidebar)
   - Queries "Your Turn" changes using Gerrit filters
   - Manages state for both "Your Turn" and "Batch" lists
   - **Full review support** - all voting options (-2 to +2), reviewers, CC, resolved
   - **Human-only submission** - votes require explicit user button clicks + confirmation
   - **Extensible API** for AI agents to inspect/modify batch (but NOT submit)
   - **Local HTTP API Server** for external script/AI automation
   - **Expandable file view** - click to expand any change and see its files
   - **File diff integration** - click any file to open VS Code diff view
   - **Drag and drop** - drag changes between lists

2. **Local HTTP API Server** (`src/lib/batchReviewApi/server.ts`)
   - Lightweight server using Node's built-in `http` module
   - Only listens on localhost (127.0.0.1) for security
   - Exposes REST-like endpoints for batch list management
   - **Supports AI confidence scores (1-10)** for prioritizing changes
   - **No endpoints for voting/submitting** - those remain human-only
   - Server only runs when user explicitly requests automation

3. **Frontend UI** (`src/views/editor/batchReview/html/src/`)
   - React-based webview with modern, professional design
   - Two-list layout: "Your Turn" (top) and "Batch" (bottom)
   - **Drag and drop** - drag items between lists (supports multi-select)
   - **Expandable change items** - click chevron to see files
   - **Clickable files** - opens diff view in VS Code
   - **AI confidence score display** (1-10) on batch items
   - **Score-based sorting** - batch sorted by AI confidence (highest first)
   - **Full review panel**:
     - Reviewers field with autocomplete
     - CC field with autocomplete
     - Comment textarea
     - Resolved checkbox
     - Score pickers for all labels (-2, -1, 0, +1, +2)
     - Submit patch button
     - Send button
   - Checkbox multi-selection with "Select All" functionality
   - Loading states and user feedback
   - Responsive design with VSCode theming and codicons

4. **Styling** (`src/views/editor/batchReview/css/index.css`)
   - Professional VSCode-themed UI
   - Responsive layout (stacks vertically on mobile, side-by-side on desktop)
   - File status indicators (Added, Modified, Deleted, Renamed)
   - Color-coded score badges (red→yellow→green for 1-10)
   - Drag and drop visual feedback
   - Review panel with score buttons
   - File view toggle (List/Tree mode)
   - Proper accessibility and keyboard navigation

## 🚀 How to Use

### Opening Batch Review
- **Option 1**: Click the **layers icon** (📚) in the Gerrit sidebar title bar
- **Option 2**: Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P) → Type "Gerrit: Open Batch Review"

### Using Batch Review
1. **View "Your Turn" changes** - changes requiring your attention
2. **Select changes** using checkboxes (or "Select All"), or **drag and drop** them
3. **Add to Batch** using the arrow-down button or by dragging to the Batch section
4. **Toggle file view** - use the List/Tree buttons to switch between flat list and nested folder view
5. **Expand changes** - click the chevron to see files in each change
6. **View diffs** - click any file to open the diff in VS Code
7. **Configure review**:
   - Add reviewers and CC using the autocomplete fields
   - Write a comment
   - Check "Resolved" if appropriate
   - Select scores for each label (-2 to +2)
8. **Submit** using "Submit patch" or "Send" button
9. **Done!** All changes in batch receive your vote

### Automatic API Server
- The local API server **starts automatically** when you open Batch Review
- Look for the green **✓ :PORT** indicator in the header
- The server **stops automatically** when you close the panel

## 🔐 Security Features

### Human-Only Submission
- Vote submission requires **explicit user action**:
  - User must click +1 or +2 button
  - Confirmation dialog prevents accidents
  - No programmatic way to trigger submission

### Extensible API for AI Agents
AI agents (like openCode agents) can use the public API:

```typescript
const provider = getBatchReviewProvider();

// Add changes to batch
provider.addToBatch(['change-id-1', 'change-id-2']);

// Remove changes from batch
provider.removeFromBatch(['change-id-1']);

// Inspect batch contents
const batchChanges = provider.getBatchChanges();
const incomingChanges = provider.getIncomingChanges();

// NOTE: AI agents CANNOT submit votes - that's human-only!
```

### Local HTTP API for External Automation

When you open the Batch Review panel, a local HTTP server starts automatically that allows external scripts or AI tools to interact with the batch list.

#### API Overview

The local API provides a **stateless, REST-like interface** for batch review automation. It's designed for:

- **AI agents** that analyze changes and suggest which ones to review
- **Scripts** that automate batch building based on custom criteria
- **External tools** that integrate with Gerrit workflows

**Important Security Note**: The API only allows **reading and building the batch list**. All actual review submissions remain **human-only** through the UI.

#### Server Status
- Server **starts automatically** when Batch Review opens
- Look for the green **✓ :45193** indicator in the header
- Server **stops automatically** when panel closes
- Always binds to **localhost only** (127.0.0.1:45193)

#### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check - returns `{ "status": "ok" }` |
| `/batch` | GET | Returns current batch list: `{ "batch": [...] }` |
| `/batch` | POST | Adds changes to batch. Body: `{ "changeIDs": ["id1", "id2"], "scores": { "id1": 8, "id2": 5 } }` |
| `/batch` | DELETE | Clears the entire batch list |
| `/your-turn` | GET | Returns "Your Turn" changes (read-only): `{ "yourTurn": [...] }` |

#### Data Types

**BatchReviewChange object:**
```typescript
interface BatchReviewChange {
  changeID: string;      // Gerrit Change-Id
  number: number;        // Change number (e.g., 250732)
  subject: string;       // Commit message subject line
  project: string;       // Gerrit project name
  owner: string;         // Owner display name
  updated: string;       // Last updated timestamp (ISO 8601)
  url: string;           // Gerrit Web UI URL for this change
  score?: number;        // AI confidence score (1-10), only on batch items
  files?: FileInfo[];    // File list (only if expanded)
  filesLoaded?: boolean; // True if files have been fetched
}
```

**Score values (1-10):**
- 1-2: Low confidence (red badge) - likely needs manual review
- 3-4: Below average confidence (orange badge)
- 5-6: Medium confidence (yellow badge)
- 7-8: Above average confidence (light green badge)
- 9-10: High confidence (green badge) - AI is confident in review

#### Example Usage

```bash
# Check server health
curl http://127.0.0.1:45193/health

# Get current batch
curl http://127.0.0.1:45193/batch

# Add changes to batch with AI confidence scores
curl -X POST http://127.0.0.1:45193/batch \
  -H "Content-Type: application/json" \
  -d '{"changeIDs": ["I1234567890abcdef", "I0987654321fedcba"], "scores": {"I1234567890abcdef": 9, "I0987654321fedcba": 6}}'

# Add changes without scores (manual review)
curl -X POST http://127.0.0.1:45193/batch \
  -H "Content-Type: application/json" \
  -d '{"changeIDs": ["I1234567890abcdef"]}'

# Clear batch
curl -X DELETE http://127.0.0.1:45193/batch

# Get "Your Turn" changes
curl http://127.0.0.1:45193/your-turn
```

#### Automation Workflow Example

Here's a typical AI automation workflow:

```python
import requests
import json

API_BASE = "http://127.0.0.1:45193"

def get_your_turn_changes():
    """Fetch changes requiring review."""
    resp = requests.get(f"{API_BASE}/your-turn")
    return resp.json()["yourTurn"]

def analyze_and_score_changes(changes):
    """AI analyzes changes and assigns confidence scores."""
    scores = {}
    high_confidence_ids = []
    
    for change in changes:
        # Your AI logic here to determine confidence
        score = my_ai_model.analyze(change)
        
        if score >= 7:  # High confidence
            high_confidence_ids.append(change["changeID"])
            scores[change["changeID"]] = score
    
    return high_confidence_ids, scores

def add_to_batch(change_ids, scores):
    """Add changes to batch with scores."""
    resp = requests.post(
        f"{API_BASE}/batch",
        json={"changeIDs": change_ids, "scores": scores}
    )
    return resp.json()

# Main workflow
changes = get_your_turn_changes()
ids_to_batch, scores = analyze_and_score_changes(changes)
result = add_to_batch(ids_to_batch, scores)
print(f"Added {len(ids_to_batch)} changes to batch")

# Now the human reviewer opens the Batch Review panel and:
# 1. Sees changes sorted by AI confidence score
# 2. Expands high-confidence changes to review files
# 3. Makes final decision and submits review
```

#### Error Handling

All error responses return JSON with an `error` field:

```json
{"error": "Invalid request body. Expected { changeIDs: string[], scores?: { [changeID: string]: number } }"}
```

HTTP status codes:
- `200` - Success
- `400` - Bad request (invalid JSON, missing fields)
- `404` - Unknown endpoint
- `413` - Request body too large (max 1MB)

#### Security Notes
- Server **only binds to localhost** (127.0.0.1) - not accessible from network
- Uses a **fixed port** (45193) for consistent, predictable access
- **No voting/submission endpoints** - all review actions remain human-only
- Request body size limited to **1MB** to prevent memory issues
- Server **only runs when Batch Review is open**

## 📁 Files Created

### Source Code (11 new files)
```
src/views/editor/batchReview.ts                              (420+ lines)
src/views/editor/batchReview/types.ts
src/views/editor/batchReview/messaging.ts
src/views/editor/batchReview/state.ts
src/views/editor/batchReview/html.ts
src/views/editor/batchReview/html/src/index.tsx
src/views/editor/batchReview/html/src/lib/api.ts
src/views/editor/batchReview/html/src/ui/BatchReviewPane.tsx (340+ lines)
src/views/editor/batchReview/html/src/tsconfig.json
src/views/editor/batchReview/css/index.css                   (390+ lines)
src/lib/batchReviewApi/server.ts                             (250 lines) [NEW]
```

### Modified Files (6 files)
```
package.json                      (added build scripts + command)
src/commands/command-names.ts     (added OPEN_BATCH_REVIEW)
src/commands/defs.ts              (added command definition)
src/commands/commands.ts          (added command handler)
src/tsconfig.json                 (excluded batch review HTML)
.gitignore                        (excluded lock files)
```

## 🛠️ Build System Integration

### Build Scripts Added
```json
{
  "build:batchReview:js": "esbuild --bundle --outfile=out/batchReview/index.js ...",
  "build:batchReview:css": "copy src/views/editor/batchReview/css/index.css ...",
  "build:batchReview:codicons:css": "copy node_modules/@vscode/codicons/...",
  "build:batchReview:codicons:ttf": "copy node_modules/@vscode/codicons/..."
}
```

### Build Process
1. Run `npm install` to install dependencies
2. Run `npm run build` or `npm run build:debug` to compile
3. Output goes to `out/batchReview/`:
   - `index.js` (React app bundle)
   - `index.css` (styles)
   - `codicon.css` + `codicon.ttf` (VSCode icons)

## ✅ Implementation Status

### Completed
- ✅ All backend logic implemented and type-safe
- ✅ All frontend UI components implemented
- ✅ Professional styling with VSCode theming
- ✅ Command registered and integrated
- ✅ Build scripts working
- ✅ TypeScript compilation succeeds
- ✅ esbuild bundling succeeds
- ✅ Human-only submission enforced
- ✅ Extensible API for AI agents
- ✅ No generated files in git

### Ready for Testing
The feature is **code-complete** and ready for manual testing:
- [ ] F5 launch in VSCode development instance
- [ ] Connect to a Gerrit server
- [ ] Open batch review and verify UI
- [ ] Test batch voting functionality
- [ ] Verify human-only submission
- [ ] Test extensible API for AI agents

## 📊 Statistics

- **~2,000 lines** of new code
- **11 new files** created
- **6 files** modified
- **0 dependencies** added (uses existing React/VSCode APIs + Node http module)
- **Human-only submission** guaranteed
- **AI-extensible** for batch management via TypeScript API and HTTP API

## 🎨 UI Features

- Modern, professional design
- VSCode theme integration (light/dark mode support)
- Codicon icons throughout
- Responsive layout
- Accessible (keyboard navigation, ARIA labels)
- Loading states
- Error handling with user feedback
- Confirmation dialogs

## 🔄 State Management

The Batch Review feature uses robust, state-machine-like patterns:

### Selection State Machine
```
States: idle → single-select → multi-select (shift/ctrl) → action
Transitions:
  - Plain click → Set anchor, select single item
  - Shift+click → Range select from anchor to current (adds to selection)
  - Ctrl/Cmd+click → Toggle individual item, reset anchor
  - Checkbox toggle → Toggle individual item
  - Changes modified → Reset anchor (prevents stale references)
```

### API Server State Machine
```
States: stopped → starting → running → stopping → stopped
Transitions:
  - Panel opens → Start server
  - Panel closes → Stop server
  - Concurrent start attempts → Rejected (prevents race conditions)
```

### Key Implementation Patterns
- **Immutable state updates** - all state changes create new objects/arrays
- **Anchor-based range selection** - robust shift-click behavior
- **Stateless API design** - each HTTP request is self-contained
- **Defensive validation** - all inputs are validated before use
- **Type-safe TypeScript** - full type coverage throughout
- **Message passing** - clean separation between webview and extension

### React State Architecture
```typescript
// Main state flows through single state object
interface BatchReviewState {
  incomingChanges: BatchReviewChange[];
  batchChanges: BatchReviewChange[];
  loading: boolean;
  error?: string;
  // ... review panel state
}

// Updates via message passing
vscode.postMessage({ type: 'messageType', body: { ... } });
```

## 🎯 Next Steps

1. **Manual Testing**: Launch in VSCode with F5
2. **Connect to Gerrit**: Test with real Gerrit instance
3. **Verify UI**: Check that UI is responsive and accessible
4. **Test Batch Review**: Submit batch reviews and verify votes
5. **Security Check**: Confirm human-only submission works
6. **AI API Test**: Verify extensible API for AI agents

## 📝 Notes

- Only source code files are committed (no lock files or build outputs)
- Pre-existing errors in `commentProvider.ts` are unrelated to this feature
- Build uses Bun-compatible workflow (but also works with npm/npx)
- All code follows existing patterns in the repository
- No breaking changes to existing functionality
