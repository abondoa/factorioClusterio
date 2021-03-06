const assert = require("assert").strict;
const fs = require("fs-extra");
const jszip = require("jszip");
const path = require("path");

const factorio = require("lib/factorio");


// The server integration test is required to run before this one
require("./server")

describe("Integration of lib/factorio/patch", function() {
	describe("patch()", function() {
		let savePath = path.join("test", "temp", "integration", "saves", "test.zip");
		it("should patch a freeplay game", async function() {
			await factorio.patch(savePath, [{
				name: "test",
				files: [{ path: "test.lua", content: "-- test" }]
			}]);

			let zip = await jszip.loadAsync(await fs.readFile(savePath));
			let content = await zip.file("test/modules/test.lua").async("string");
			assert.equal(content, "-- test");
		});
		it("should remove old modules in a save", async function() {
			await factorio.patch(savePath, [{ name: "test", files: [] }]);
			let zip = await jszip.loadAsync(await fs.readFile(savePath));
			assert.equal(zip.file("test/modules/test.lua"), null);
		});
	});
});
