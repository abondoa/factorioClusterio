Developing for Clusterio
========================

This document describes the various different types of content that can
be created for Factorio and/or Clusterio and how this is made compatible
with Clusterio.


Contents
--------

- [Factorio Mods](#factorio-mods)
- [Factorio Scenarios](#factorio-scenarios)
    - [event_handler interface](#event_handler-interface)
- [Communicating between Clusterio and Factorio](#communicating-between-clusterio-and-factorio)
- [Communicating with Clusterio](#communicating-with-clusterio)
- [Clusterio Modules](#clusterio-modules)
- [Clusterio Plugins](#clusterio-plugins)


Factorio Mods
-------------

Factorio mods that do not interact with Clusterio should not have any
conciderations that need to be taken into account for them to work with
Clusterio.


Factorio Scenarios
------------------

Clusterio patches saves and because of this scenarios have a few
limitations and must explicitly mark themselves as compatible with
Clusterio to work.  The main limitation is that the
[event_handler](https://github.com/wube/factorio-data/blob/master/core/lualib/event_handler.lua)
lib must be used, and control.lua cannot contain any code other than
calls to event_handler loading the relevant libs of the scenario.
This is because the control.lua file will be overwritten by the save
patcher.  Scenarios also cannot use the event registring functions
exposed by `script` such as `script.on_event` or `script.on_nth_tick` as
using these will overwrite the handlers registered by the
event_handler lib.

A breif description of the usage of the event_handler library is
provided in the [event_handler interface](#event_handler-interface)
section.

Once a scenario is made using the event_handler it should have a
control.lua file that looks something like this:

```lua
-- control.lua
local event_handler = require("event_handler")
event_handler.add_lib(require("module_foo"))
event_handler.add_lib(require("module_bar"))
```

To make Clusterio recognize and correctly handle this scenario it
needs to include a clusterio.json file with following content:

```json
{
    "scenario": {
        "name": "example-scenario",
        "modules": [
            "module_foo",
            "module_bar"
        ]
    }
}
```

This tells Clusterio that it should load both module_foo and module_bar
by passing the result of requiring them to the  `add_lib` function when
writing a new control.lua file to the save.


### event_handler interface

<sub>**Note:** At the time of writing the event_handler lib has been
a part of Factorio since at least 0.17.4, and was moved from base to
core in 0.17.63 but is still not documented anywhere.  A brief
description is provided here for this reason.</sub>

The event_handler lib provides a simple interface for registring
multiple callbacks to the same events without having to be concerned
with callback chaining or overwriting callbacks defined elsewhere.  It
works by taking over the task of registring the actual callbacks with
Factorio, providing its own interface for the rest of the code to use.

The sole function of interest exported by event_handler is `add_lib`
which accepts a table with event handler callbacks definitions that it
will register.  The following entries are recognized by `add_lib`, all
of which are optional:

- `on_init`:
    Callback called when the callback of `script.on_init` is invoked.
- `on_load`:
    Callback called when the callback of `script.on_load` is invoked.
- `on_configuration_changed`:
    Callback called when the callback of
    `script.on_configuration_changed` is invoked.
- `events`:
    Table mapping event ids as defined in `defines.events` to callbacks.
    For example the table `{ [defines.events.on_player_died] = foo }`
    will call bar with the usual `event` table as argument every time a
    player dies.
- `on_nth_tick`:
    Table mapping the nth tick number to a callback.  For example the
    table `{ [30] = bar }` will call bar every 30th tick.
- `add_remote_interface`:
    Callback called before on_init/on_load callbacks<sup>[1]</sup>.  It
    has no special meaning and receives no arguments but should be used
    for registring remote interfaces.
- `add_commands`:
    Callback called before on_init/on_load callbacks<sup>[1]</sup>.  It
    has no special meaning and receives no arguments but should be used
    for registring commands.

<sub>1: Before 0.17.69 these callbacks were called after
on_init/on_load.</sub>

The usual way to use `add_lib` is to define the table of events to
register in a separate file and return it, then load it in control.lua
via `require` before passing it to `add_lib`.  For example a module
could be defined as

```lua
-- example.lua
local function my_handler(event)
    local name = game.player[event.player_index].name
    game.print("It appears that " .. name .. " has died")
end

return {
    on_init = function() game.print("example_lib init") end,
    events = {
        [defines.events.on_player_died] = my_handler,
    },
}
```

And then in control.lua the following used to load it with `add_lib`:

```lua
-- control.lua
local event_handler = require("event_handler")
event_handler.add_lib(require("example"))
```

Because the event_handler lib registers events itself you may not use
`script.on_load` or `script.on_init` at all in your code and any usage
of `script.on_configuration_changed`, `script.on_nth_tick` and/or
`script.on_event` will cause the corresponding events registered with
event_handler to break and should therefore not be used.

There's also the `add_libraries` function exported by event_handler,
which accepts a table and calls `add_lib` for each value in the table.


Communicating between Clusterio and Factorio
--------------------------------------------

There is currently no standard interface for moving data between
Clusterio and Factorio.  It's mostly a mix of RCON commands initiated
from Clusterio plugins and writing out files with `game.write_file` that
is picked up and parsed by plugins.


Communicating with Clusterio
----------------------------

There's a poorly to virtuarly undocumented HTTP interface that can be
used to communicate with Clusterio to do things like get the status of
instances, grab items from the store, run commands on instances, etc,
etc.  For now you can read the source code, and maybe ask on the Discord
for some pointers if you get stuck.


Clusterio Modules
-----------------

Modules are primarily used by plugins to inject code into Factorio
games with the save patcher.  The save patcher puts modules into the
`modules` folder of the Factorio save and adds code to `control.lua` to
load the modules by requiring it and passing the result of the require
call to the `add_lib` function of the event_handler lib.  See the
section on the [event_handler interface](#event_handler-interface) for a
detailed description on how this works.

Because modules can be patched into an existing game you cannot rely on
the `on_init` callback to be called in Clusterio Modules.  Nor can you
rely on the `on_configuration_changed` callback, as this is not called
when level code changes.  Instead you will have to initialize whatever
global variable you need when you first use them.

Currently any files in a folder named `lua` in a Clusterio plugin is
assumed to be a module and will be patched into the save before starting
up Factorio.  This will most likely change with the planned plugin
restructuring.


Clusterio Plugins
-----------------

The plugin interface is undergoing a major rewrite, and will be
documented once that is done.  See
[issue #220](https://github.com/clusterio/factorioClusterio/issues/220)
for details.
