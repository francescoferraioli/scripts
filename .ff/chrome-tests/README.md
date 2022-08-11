# Running a test

```
ff chrome-tests [build] exec (run|debug) (test NAME|class NAME|debug-this-test)
```

- build: if you want it to build, otherwise omit it
- run: If you want headless, otherwise use debug
- test: A specific test
- class: A specific class
- debug-this-test: The ones with the `DebugThisTest` attribute

# Running a playground

```
ff chrome-tests [build] playground PREFIX SUFFIX
```

If there's no prefix just use `''`.

## Examples:

Run the following command to get the options:

```
ff chrome-tests playgrounds
```