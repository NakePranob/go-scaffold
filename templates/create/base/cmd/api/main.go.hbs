package main

import (
	"log/slog"
	"os"
)

// main decides the exit code and nothing else. Everything it used to do lives
// in run() — see wiring.go, which is this binary's composition root: the one
// place that sees every module and hands them what they need.
//
// Two things that split buys. Deferred cleanup actually runs, because os.Exit
// skips defers and this doesn't call it until run has returned — telemetry
// shutdown and the signal handler used to be silently abandoned on a startup
// error. And run() is an ordinary function returning an ordinary error, so a
// test can call it.
//
// wiring.go is also the file `go-scaffold` patches. Keeping it out of main.go
// means the first file you open to understand this binary is not the one that
// grows a line every time a module is added.
func main() {
	if err := run(); err != nil {
		// Correct before and after run() sets the JSON handler: slog's default
		// writes to stderr, so a failure this early is still reported.
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
}
