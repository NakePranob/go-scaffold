// Unit tests for the marker-patching primitives every `add`/`generate`/
// `undo` command is built on. These are pure string functions, so they can
// be tested directly — previously their only coverage was the smoke suite,
// which needs a Go toolchain plus Docker and takes minutes, so a line-matching
// bug could only be caught end-to-end and only if some scenario happened to
// hit it.
import test from "node:test";
import assert from "node:assert/strict";

import {
  hasMarker,
  insertBeforeMarker,
  insertBeforeMarkerOnce,
  removeBlock,
  removeLines,
  removeLinesByPrefix,
} from "../../dist/utils/marker-patch.js";

const MARKER = "// go-scaffold:routes";

function mainGo(...body) {
  return ["func main() {", ...body.map((l) => `\t${l}`), `\t${MARKER}`, "}", ""].join("\n");
}

test("insertBeforeMarker re-indents to match the marker's own indentation", () => {
  const out = insertBeforeMarker(mainGo(), MARKER, "orderSvc := order.NewService(db)");
  assert.match(out, /\n\torderSvc := order\.NewService\(db\)\n\t\/\/ go-scaffold:routes/);
});

test("insertBeforeMarker names the marker it couldn't find", () => {
  assert.throws(() => insertBeforeMarker("func main() {}\n", MARKER, "x"), /go-scaffold:routes/);
});

test("insertBeforeMarkerOnce is idempotent on its sentinel", () => {
  const once = insertBeforeMarkerOnce(mainGo(), MARKER, "a := 1", "a :=");
  const twice = insertBeforeMarkerOnce(once, MARKER, "a := 1", "a :=");
  assert.equal(once, twice);
});

// The bug this guards: a duplicate route line builds and vets cleanly, then
// panics gin at startup with "handlers are already registered".
test("insertBeforeMarkerOnce matches a sentinel that is only a prefix of the line", () => {
  const wired = insertBeforeMarkerOnce(mainGo(), MARKER, "orderSvc := order.NewService(db)", "orderSvc :=");
  // the user has since given the service a dependency
  const edited = wired.replace("order.NewService(db)", "order.NewService(db, userSvc)");
  const again = insertBeforeMarkerOnce(edited, MARKER, "orderSvc := order.NewService(db)", "orderSvc :=");
  assert.equal(again, edited, "must not add a second service line");
});

test("removeLines drops only exact trimmed matches, not substrings", () => {
  const content = ["\tfoo()", "\tfoobar()", ""].join("\n");
  assert.equal(removeLines(content, ["foo()"]), ["\tfoobar()", ""].join("\n"));
});

// removeBlock exists because two modules' CREATE SCHEMA blocks are identical
// apart from the schema name: three of their four lines collide exactly.
test("removeBlock removes one module's schema block and leaves its twin intact", () => {
  const schemaBlock = (name) =>
    [
      `if err := db.Exec("CREATE SCHEMA IF NOT EXISTS ${name}").Error; err != nil {`,
      `\tlogger.Error("create schema", "error", err)`,
      `\tos.Exit(1)`,
      `}`,
    ].join("\n");

  const content = mainGo(...schemaBlock("order_svc").split("\n"), ...schemaBlock("product_svc").split("\n"));
  const out = removeBlock(content, schemaBlock("order_svc"));

  assert.ok(!out.includes("order_svc"), "order's block should be gone");
  assert.ok(out.includes("product_svc"), "product's block must survive");
  assert.equal(out.match(/os\.Exit\(1\)/g)?.length, 1, "only product's os.Exit line should remain");
});

test("removeLinesByPrefix removes a single-line wiring statement", () => {
  const content = mainGo("orderSvc := order.NewService(order.NewRepository(db))", "keepMe := 1");
  const out = removeLinesByPrefix(content, ["orderSvc :="]);
  assert.ok(!out.includes("orderSvc"));
  assert.ok(out.includes("keepMe := 1"));
});

// docs/architect/patterns.md tells you to expand that one line into a
// multi-line adapter literal. Removing only line one used to leave the func
// body orphaned, and main.go stopped parsing — after `undo module` had
// already printed success in green.
test("removeLinesByPrefix consumes a wiring statement the user expanded over several lines", () => {
  const content = mainGo(
    "orderSvc := order.NewService(order.NewRepository(db), order.UserLookupFunc(",
    "\tfunc(ctx context.Context, id uuid.UUID) (string, error) {",
    "\t\tu, err := userSvc.Get(ctx, id)",
    "\t\tif err != nil {",
    '\t\t\treturn "", err',
    "\t\t}",
    "\t\treturn u.Email, nil",
    "\t},",
    "))",
    "productSvc := product.NewService(product.NewRepository(db))"
  );

  const out = removeLinesByPrefix(content, ["orderSvc :="]);

  for (const orphan of ["orderSvc", "UserLookupFunc", "u.Email", "context.Context"]) {
    assert.ok(!out.includes(orphan), `"${orphan}" should have been consumed with the statement`);
  }
  assert.ok(out.includes("productSvc := product.NewService(product.NewRepository(db))"), "the next module must survive");
  // the closing "))" of the adapter must go too — count the ones that are a
  // line of their own, since the surviving product line legitimately ends in ))
  assert.equal(out.split("\n").filter((l) => l.trim() === "))").length, 0, "the adapter's closing line should be gone");
});

// bracketDelta counts text, so an unbalanced bracket inside a string literal
// used to leave the count permanently open — and the consume-until-balanced
// loop then ate every remaining line, wiping every other module's wiring and
// main.go's closing brace.
test("removeLinesByPrefix ignores brackets inside string literals and comments", () => {
  for (const wiring of [
    'orderSvc := order.NewService(db, order.WithPrefix("("))',
    "orderSvc := order.NewService(db) // wired by hand (see patterns.md",
    'orderSvc := order.NewService(db, order.Sep(`)`))',
  ]) {
    const content = mainGo(wiring, "productSvc := product.NewService(db)");
    const out = removeLinesByPrefix(content, ["orderSvc :="]);
    assert.ok(!out.includes("orderSvc"), `should have removed: ${wiring}`);
    assert.ok(out.includes("productSvc := product.NewService(db)"), `ate the next module for: ${wiring}`);
    assert.ok(out.includes(MARKER), `ate the marker for: ${wiring}`);
  }
});

// Refusing is the whole point: consuming to EOF would delete everything after
// the statement. undo un-wires before it deletes anything, so a throw here
// leaves the project exactly as it was.
test("removeLinesByPrefix refuses a statement whose brackets never close", () => {
  const content = ["orderSvc := order.NewService(db,", "productSvc := product.NewService(db)", ""].join("\n");
  assert.throws(() => removeLinesByPrefix(content, ["orderSvc :="]), /never closes its brackets/);
});

// The nastier shape: the count does eventually balance, on main()'s own
// closing brace. Without the marker boundary the consume loop swallowed the
// marker and every module wired after it, and only failed later — from the
// unrelated "routes marker not found" that the damage itself caused.
test("removeLinesByPrefix refuses rather than consuming through the marker", () => {
  const content = mainGo(
    "orderSvc := order.NewService(order.NewRepository(db),",
    "order.NewHandler(orderSvc).Register(api)",
    "productSvc := product.NewService(product.NewRepository(db))",
    "product.NewHandler(productSvc).Register(api)"
  );
  assert.throws(() => removeLinesByPrefix(content, ["orderSvc :="]), /never closes its brackets/);
});

test("removeLinesByPrefix leaves everything alone when nothing matches", () => {
  const content = mainGo("productSvc := product.NewService(db)");
  assert.equal(removeLinesByPrefix(content, ["orderSvc :="]), content);
});

test("hasMarker ignores indentation but requires the whole line", () => {
  assert.ok(hasMarker(`\t${MARKER}\n`, MARKER));
  assert.ok(!hasMarker(`\tfoo() ${MARKER}\n`, MARKER));
});
