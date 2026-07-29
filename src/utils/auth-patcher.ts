import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const CONFIG_FIELDS_MARKER = "// go-scaffold:config-fields";
const CONFIG_LOAD_MARKER = "// go-scaffold:config-load";
const CONFIG_CHECKS_MARKER = "// go-scaffold:config-checks";
const MODEL_MARKER = "// go-scaffold:models";
const ROUTE_MARKER = "// go-scaffold:routes";

// patchConfigForAuth adds JWT + cookie fields to Config, the same
// marker-based text insertion patchConfigForWorker uses (config.go.hbs is
// only rendered once, at `create` — everything after that is a real file a
// human may have already edited).
export function patchConfigForAuth(configGoPath: string): void {
  let content = fs.readFileSync(configGoPath, "utf8");

  const fieldsBlock = ["JWTSecret string", "JWTAccessTTL time.Duration", "JWTRefreshTTL time.Duration", "CookieSecure bool"].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_FIELDS_MARKER, fieldsBlock, "JWTSecret string");

  const loadBlock = [
    'JWTSecret:     env("JWT_SECRET", "dev-secret-change-me"),',
    'JWTAccessTTL:  time.Duration(envInt("JWT_ACCESS_TTL_MIN", 15)) * time.Minute,',
    'JWTRefreshTTL: time.Duration(envInt("JWT_REFRESH_TTL_MIN", 43200)) * time.Minute,',
    'CookieSecure:  env("COOKIE_SECURE", "false") == "true",',
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_LOAD_MARKER, loadBlock, 'JWTSecret:     env("JWT_SECRET"');

  fs.writeFileSync(configGoPath, content);
}

// patchMainGoForAuth wires the user domain into cmd/api: its import, its two
// models in the AutoMigrate call, a prod guard against the still-default JWT
// secret, and its route registration (the domain's own Handler.Register
// splits /auth public vs /users protected — main.go doesn't need to know
// that split, same convention as every other module).
export function patchMainGoForAuth(mainGoPath: string, goModule: string): void {
  let content = fs.readFileSync(mainGoPath, "utf8");

  const importLine = `"${goModule}/internal/app/user"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);

  const modelImportLine = `usermodel "${goModule}/internal/app/user/model"`;
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);

  const checkBlock = [
    'if cfg.IsProd() && cfg.JWTSecret == "dev-secret-change-me" {',
    '\tlogger.Error("JWT_SECRET is still the dev default — set a real secret before deploying with APP_ENV=production")',
    "\tos.Exit(1)",
    "}",
  ].join("\n");
  content = insertBeforeMarkerOnce(content, CONFIG_CHECKS_MARKER, checkBlock, "JWT_SECRET is still the dev default");

  const migrateLine1 = "&usermodel.User{},";
  const migrateLine2 = "&usermodel.Identity{},";
  content = insertBeforeMarkerOnce(content, MODEL_MARKER, migrateLine1, migrateLine1);
  content = insertBeforeMarkerOnce(content, MODEL_MARKER, migrateLine2, migrateLine2);

  const routeLine =
    "user.NewHandler(user.NewService(user.NewRepository(db), user.NewRedisTokenStore(rdb), cfg), cfg.JWTSecret, cfg.JWTRefreshTTL, cfg.CookieSecure).Register(api)";
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, routeLine, routeLine);
  content = content.replace(/\n\t_ = api \/\/ dropped once `generate module` registers the first route\n/, "\n");

  fs.writeFileSync(mainGoPath, content);
}
