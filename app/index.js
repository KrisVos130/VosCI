let express = require("express");
let config = require("config");
let async = require("async");
let bodyParser = require('body-parser');
let app = express();
let GitHubApi = require("github");
let CLIEngine = require("eslint").CLIEngine;
let simpleGit = require('simple-git')("../container");

let github = new GitHubApi({});
github.authenticate({
	type: "token",
	token: config.get("github.token")
});

async.waterfall([
	(next) => {
		simpleGit.init(next);
	},

	(next) => {
		simpleGit.removeRemote("origin", () => {
			next();
		});
	},

	(next) => {
		simpleGit.addRemote("origin", `https://${config.get("github.username")}:${config.get("github.token")}@github.com/${config.get("github.repo.owner")}/${config.get("github.repo.name")}.git`, next);
	},

	(next) => {
		app.use(bodyParser.urlencoded({extended: false}));
		app.use(bodyParser.json());

		app.post('/event_handler', (req, res) => {
			let payload = JSON.parse(req.body.payload);
			async.waterfall([
				(next) => {
					if (req.get("X-GitHub-Event") !== 'pull_request') return next('Event not a pull request.');
					if (payload.action !== "opened" && payload.action !== "synchronize") return next('Event action not opened or synchronize.');
					next();
				},

				(next) => {
					github.repos.createStatus({
						owner: config.get("github.repo.owner"),
						sha: payload.pull_request.head.sha,
						repo: config.get("github.repo.name"),
						state: "pending"
					}, next);
				},

				() => {
					checkPullRequest(function (cb) {
						async.waterfall([
							(next) => {
								simpleGit.checkout("--detach", () => {
									next();
								});
							},

							(next) => {
								simpleGit.fetch("origin", `pull/${payload.number}/head:${payload.pull_request.head.ref}`, {'--update-head-ok': null}, next);
							},

							(res, next) => {
								simpleGit.checkout(payload.pull_request.head.ref, next);
							},

							(res, next) => {
								var cli = new CLIEngine({
									"extends": "../container/.eslintrc"
								});
								var report = cli.executeOnFiles(["../container"]);
								console.log("Errors: ", report.results[0].errorCount);
								if (report.results[0].errorCount > 0) return next('There were errors found when checking ESlint.');
								next();
							}
						], (err) => {
							if (err) {
								github.repos.createStatus({
									owner: config.get("github.repo.owner"),
									sha: payload.pull_request.head.sha,
									repo: config.get("github.repo.name"),
									state: "error"
								});
								cb();
								return res.end();
							}
							github.repos.createStatus({
								owner: config.get("github.repo.owner"),
								sha: payload.pull_request.head.sha,
								repo: config.get("github.repo.name"),
								state: "success"
							});
							cb();
							res.end();
						});
					});
				}
			], (err) => {
				res.end();
			});
		});
		next();
	}
], (err) => {
	if (err) {
		console.log("Error while initialising", err);
		return;
	}
	app.listen(4567, function () {
		console.log('App listening on port 4567!')
	});
});

var checking = false;
var callbacks = [];

function checkPullRequest(cb) {
	if (!checking) {
		checking = true;
		cb(checkCallbacks);
	} else {
		callbacks.push(cb);
	}
}

function checkCallbacks() {
	if (callbacks.length > 0) {
		var callback = callbacks.shift();
		callback(checkCallbacks);
	} else {
		checking = false;
	}
}