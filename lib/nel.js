/*
 * BSD 3-Clause License
 *
 * Copyright (c) 2015, Nicolas Riesco and others as credited in the AUTHORS file
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 * may be used to endorse or promote products derived from this software without
 * specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *
 */

/** @module nel
 *
 * @description Module `nel` provides a Javascript REPL session. A Javascript
 * session can be used to run Javascript code within `Node.js`, pass the result
 * to a callback function and even capture its `stdout` and `stderr` streams.
 *
 */
module.exports = {
    Session: Session,
};

var DEBUG = global.DEBUG || false;

var log;
if (DEBUG) {
    var console = require("console");
    log = function log() {
        process.stderr.write("NEL: ");
        console.error.apply(this, arguments);
    };
} else {
    try {
        log = require("debug")("NEL:");
    } catch (err) {
        log = function noop() {};
    }
}

var spawn = require("child_process").spawn;
var fs = require("fs");
var path = require("path");

var doc = require("./mdn.js"); // Documentation for Javascript builtins

// File paths
var paths = {
    node: process.argv[0],
    thisFile: fs.realpathSync(module.filename),
};
paths.thisFolder = path.dirname(paths.thisFile);
paths.client = paths.thisFile;
paths.server = path.join(paths.thisFolder, "nel_server.js");

/**
 * Javascript session configuration.
 *
 * @typedef Config
 *
 * @property {String} cwd Session current working directory
 *
 * @see {@link module:nel~Session}
 */

/**
 * @class
 * @classdesc Implements a Javascript session
 * @param {module:nel~Config} [nelConfig] Javascript session configuration.
 */
function Session(nelConfig) {
    /**
     * Task currently being run (`null` if none)
     * @member {?module:nel~Task}
     * @private
     */
    this._task = null;

    /**
     * Queue of tasks to be run
     * @member {module:nel~Task[]}
     * @private
     */
    this._tasks = [];

    /**
     * Session configuration
     * @member {module:nel~Config}
     * @private
     */
    this._config = nelConfig || {};
    this._config.stdio = ["pipe", "pipe", "pipe", "ipc"];

    /**
     * Server that runs the code requests for this session
     * @member {module:child_process~ChildProcess}
     * @private
     */
    this._server = spawn(Session._command, Session._args, this._config);

    /**
     * A writeable stream that represents the session stdin
     * @member {module:stream~Writable}
     */
    this.stdin = this._server.stdin;

    /**
     * A readable stream that represents the session stdout
     * @member {module:stream~Readable}
     */
    this.stdout = this._server.stdout;

    /**
     * A readable stream that represents the session stderr
     * @member {module:stream~Readable}
     */
    this.stderr = this._server.stderr;

    /**
     * True after calling {@link module:nel~Session.kill}, otherwise false
     * @member {Boolean}
     * @private
     */
    this._killed = false;

    this._server.on("message", Session.prototype._onMessage.bind(this));
}

/**
 * Path to node executable
 * @member {String}
 * @private
 */
Session._command = paths.node;

/**
 * Arguments passed onto the node executable
 * @member {String[]}
 * @private
 */
Session._args = ["--eval", fs.readFileSync(paths.server)]; // --eval workaround

/**
 * Combination of a piece of code to be run within a session and all the
 * associated callbacks.
 * @see {@link module:nel~Session#_run}
 *
 * @typedef Task
 *
 * @property {string}                 action      Type of task:
 *                                                "run" to evaluate a piece of
 *                                                code and return the result;
 *                                                "getAllPropertyNames" to
 *                                                evaluate a piece of code and
 *                                                return all the property names
 *                                                of the result;
 *                                                "inspect" to inspect an object
 *                                                and return information such as
 *                                                the list of constructors,
 *                                                string representation,
 *                                                length...
 * @property {string}                 code        Code to evaluate
 * @property {module:nel~OnSuccessCB} [onSuccess] Called if no errors occurred
 * @property {module:nel~OnErrorCB}   [onError]   Called if an error occurred
 * @property {module:nel~BeforeRunCB} [beforeRun] Called before running the code
 * @property {module:nel~AfterRunCB}  [afterRun]  Called after running the code
 *
 * @private
 */

/**
 * Callback invoked before running a task
 * @see {@link module:nel~Task}
 *
 * @callback BeforeRunCB
 */

/**
 * Callback invoked after running a task (regardless of success or failure)
 * @see {@link module:nel~Task}
 *
 * @callback AfterRunCB
 */

/**
 * Callback invoked with the error obtained while running a task
 * @see {@link module:nel~Task}
 *
 * @callback OnErrorCB
 * @param {module:nel~ErrorResult} error
 */

/**
 * Callback invoked with the result of a task
 * @see {@link module:nel~Task}
 *
 * @typedef OnSuccessCB {
 *     module:nel~OnExecutionSuccessCB |
 *     module:nel~OnCompletionSuccessCB |
 *     module:nel~OnInspectionSuccessCB |
 *     module:nel~OnNameListSuccessCB
 * }
 */

/**
 * Callback run with the result of an execution request
 * @see {@link module:nel~Session#execute}
 *
 * @callback OnExecutionSuccessCB
 * @param {module:nel~ExecutionResult} result  MIME representations
 */

/**
 * Callback run with the result of an completion request
 * @see {@link module:nel~Session#complete}
 *
 * @callback OnCompletionSuccessCB
 * @param {module:nel~CompletionResult} result  Completion request results
 */

/**
 * Callback run with the result of an inspection request
 * @see {@link module:nel~Session#inspect}
 *
 * @callback OnInspectionSuccessCB
 * @param {module:nel~InspectionResult} result Inspection request result
 */

/**
 * Callback run with the list of all the property names
 *
 * @callback OnNameListSuccessCB
 * @param {module:nel~NameListResult} result  List of all the property names
 *
 * @private
 */

/**
 * Callback run after the session server has been killed
 * @see {@link module:nel~Session#kill}
 *
 * @callback KillCB
 * @param {Number} [code]    Exit code from session server if exited normally
 * @param {String} [signal]  Signal passed to kill the session server
 */

/**
 * Callback run after the session server has been restarted
 * @see {@link module:nel~Session#restart}
 *
 * @callback RestartCB
 * @param {Number} [code]    Exit code from old session if exited normally
 * @param {String} [signal]  Signal passed to kill the old session
 */

/**
 * Error thrown when running a task within a session
 * @see {@link module:nel~Session#execute}, {@link module:nel~Session#complete},
 * and {@link module:nel~Session#inspect}
 *
 * @typedef ErrorResult
 *
 * @property            error
 * @property {String}   error.ename      Error name
 * @property {String}   error.evalue     Error value
 * @property {String[]} error.traceback  Error traceback
 */

/**
 * Request result
 * @see {@link module:nel~Task}
 *
 * @typedef SuccessResult {
 *     module:nel~ExecutionResult |
 *     module:nel~CompletionResult |
 *     module:nel~InspectionResult |
 *     module:nel~NameListResult
 * }
 */

/**
 * MIME representations of the result of an execution request
 * @see {@link module:nel~Session#execute}
 *
 * @typedef ExecutionResult
 *
 * @property          mime
 * @property {String} [mime."text/plain"]  Result in plain text
 * @property {String} [mime."text/html"]   Result in HTML format
 */

/**
 * Results of a completion request
 * @see {@link module:nel~Session#complete}
 *
 * @typedef CompletionResult
 *
 * @property            completion
 * @property {String[]} completion.list         Array of completion matches
 * @property {String}   completion.code         Javascript code to be completed
 * @property {Integer}  completion.cursorPos    Cursor position within
 *                                              `completion.code`
 * @property {String}   completion.matchedText  Text within `completion.code`
 *                                              that has been matched
 * @property {Integer}  completion.cursorStart  Position of the start of
 *                                              `completion.matchedText` within
 *                                              `completion.code`
 * @property {Integer}  completion.cursorEnd    Position of the end of
 *                                              `completion.matchedText` within
 *                                              `completion.code`
 */

/**
 * Results of an inspection request
 * @see {@link module:nel~Session#inspect}
 *
 * @typedef InspectionResult
 *
 * @property            inspection
 * @property {String}   inspection.code         Javascript code to be inspected
 * @property {Integer}  inspection.cursorPos    Cursor position within
 *                                              `inspection.code`.
 * @property {String}   inspection.matchedText  Text within `inspection.code`
 *                                              that has been matched as an
 *                                              expression.
 * @property {String}   inspection.string       String representation
 * @property {String}   inspection.type         Javascript type
 * @property {String[]} [inspection.constructorList]
 *                                              List of constructors (not
 *                                              defined for `null` or
 *                                              `undefined`).
 * @property {Integer}  [inspection.length]     Length property (if present)
 *
 * @property            [doc]                   Defined only for calls to {@link
 *                                              module:nel~inspect} that succeed
 *                                              to find documentation for a
 *                                              Javascript expression
 * @property {String}   doc.description         Description
 * @property {String}   [doc.usage]             Usage
 * @property {String}   doc.url                 Link to the documentation source
 */

/**
 * Results of an "getAllPropertyNames" action
 * @see {@link module:nel~Task}
 *
 * @typedef NameListResult
 *
 * @property {String[]} names  List of all property names
 *
 * @private
 */

/**
 * Callback to handle messages from the session server
 *
 * @param {module:nel~SuccessResult} message Result of last execution request
 * @private
 */
Session.prototype._onMessage = function(message) {
    log("SESSION: MESSAGE", message);

    if (message.hasOwnProperty("error")) {
        if (this._task.onError) {
            this._task.onError(message);
        }
    } else {
        if (this._task.onSuccess) {
            this._task.onSuccess(message);
        }
    }

    if (this._task.afterRun) {
        this._task.afterRun();
    }

    // Are there any tasks left on the queue?
    if (this._tasks.length > 0) {
        this._runNow(this._tasks.shift());
    } else {
        this._task = null;
    }
};

/**
 * Run a task
 *
 * @param {module:nel~Task} task
 * @private
 */
Session.prototype._run = function(task) {
    if (this._killed) {
        return;
    }

    log("SESSION: TASK:", task);

    if (this._task === null) {
        this._runNow(task);
    } else {
        this._runLater(task);
    }
};

/**
 * Run a task now
 *
 * @param {module:nel~Task} task
 * @private
 */
Session.prototype._runNow = function(task) {
    this._task = task;
    if (this._task.beforeRun) {
        this._task.beforeRun();
    }

    this._server.send([this._task.action, this._task.code]);
};

/**
 * Run a task later
 *
 * @param {module:nel~Task} task
 * @private
 */
Session.prototype._runLater = function(task) {
    this._tasks.push(task);
};

/**
 * Make an execution request
 *
 * @param {String}               code                 Code to execute in session
 * @param {OnExecutionSuccessCB} [onExecutionSuccess] Callback
 * @param {OnErrorCB}            [onError]            Callback
 * @param {BeforeRunCB}          [beforeRun]          Callback
 * @param {AfterRunCB}           [afterRun]           Callback
 */
Session.prototype.execute = function(
    code,
    onExecutionSuccess, onError,
    beforeRun, afterRun
) {
    log("SESSION: EXECUTE:", code);

    this._run({
        action: "run",
        code: code,
        onSuccess: onExecutionSuccess,
        onError: onError,
        beforeRun: beforeRun,
        afterRun: afterRun,
    });
};

/**
 * Complete a Javascript expression
 *
 * @param {String}                code                  Javascript code
 * @param {Number}                cursorPos             Cursor position in code
 * @param {OnCompletionSuccessCB} [onCompletionSuccess] Callback
 * @param {OnErrorCB}             [onError]             Callback
 * @param {BeforeRunCB}           [beforeRun]           Callback
 * @param {AfterRunCB}            [afterRun]            Callback
 */
Session.prototype.complete = function(
    code, cursorPos,
    onCompletionSuccess, onError,
    beforeRun, afterRun
) {
    var matchList = [];
    var matchedText;
    var cursorStart;
    var cursorEnd;

    var expression = parseExpression(code, cursorPos);
    log("SESSION: COMPLETE: expression", expression);

    if (expression === null) {
        matchedText = "";
        cursorStart = cursorPos;
        cursorEnd = cursorPos;

        if (onCompletionSuccess) {
            onCompletionSuccess({
                completion: {
                    list: matchList,
                    code: code,
                    cursorPos: cursorPos,
                    matchedText: matchedText,
                    cursorStart: cursorStart,
                    cursorEnd: cursorEnd,
                },
            });
        }

        return;
    }

    var task = {
        action: "getAllPropertyNames",
        code: (expression.scope === "") ? "global" : expression.scope,
        beforeRun: beforeRun,
        afterRun: afterRun,
        onSuccess: function(result) {
            // append list of all property names
            matchList = matchList.concat(result.names);

            // append list of reserved words
            if (expression.scope === "") {
                matchList = matchList.concat(javascriptKeywords);
            }

            // filter matches
            if (expression.selector) {
                matchList = matchList.filter(function(e) {
                    return e.lastIndexOf(expression.selector, 0) === 0;
                });
            }

            // append expression.rightOp to each match
            var left = expression.scope + expression.leftOp;
            var right = expression.rightOp;
            if (left || right) {
                matchList = matchList.map(function(e) {
                    return left + e + right;
                });
            }

            // find range of text that should be replaced
            if (matchList.length > 0) {
                var shortestMatch = matchList.reduce(function(p, c) {
                    return p.length <= c.length ? p : c;
                });

                cursorStart = code.indexOf(expression.matchedText);
                cursorEnd = cursorStart;
                var cl = code.length;
                var ml = shortestMatch.length;
                for (var i = 0; i < ml && cursorEnd < cl; i++, cursorEnd++) {
                    if (shortestMatch.charAt(i) !== code.charAt(cursorEnd)) {
                        break;
                    }
                }
            } else {
                cursorStart = cursorPos;
                cursorEnd = cursorPos;
            }

            // return completion results to the callback
            matchedText = expression.matchedText;

            if (onCompletionSuccess) {
                onCompletionSuccess({
                    completion: {
                        list: matchList,
                        code: code,
                        cursorPos: cursorPos,
                        matchedText: matchedText,
                        cursorStart: cursorStart,
                        cursorEnd: cursorEnd,
                    },
                });
            }
        },
        onError: onError,
    };
    this._run(task);
};

/**
 * Inspect a Javascript expression
 *
 * @param {String}                code                  Javascript code
 * @param {Number}                cursorPos             Cursor position in code
 * @param {OnInspectionSuccessCB} [onInspectionSuccess] Callback
 * @param {OnErrorCB}             [onError]             Callback
 * @param {BeforeRunCB}           [beforeRun]           Callback
 * @param {AfterRunCB}            [afterRun]            Callback
 */
Session.prototype.inspect = function(
    code, cursorPos,
    onInspectionSuccess, onError,
    beforeRun, afterRun
) {
    var expression = parseExpression(code, cursorPos);
    log("SESSION: INSPECT: expression:", expression);

    if (expression === null) {
        if (onInspectionSuccess) {
            onInspectionSuccess({
                inspection: {
                    code: code,
                    cursorPos: cursorPos,
                    matchedText: "",
                    string: "",
                    type: ""
                },
            });
        }

        return;
    }

    var inspectionResult;

    var task = {
        action: "inspect",
        code: expression.matchedText,
        beforeRun: beforeRun,
        onSuccess: (function(result) {
            inspectionResult = result;
            inspectionResult.inspection.code = code;
            inspectionResult.inspection.cursorPos = cursorPos;
            inspectionResult.inspection.matchedText = expression.matchedText;

            getDocumentationAndInvokeCallbacks.call(this);
        }).bind(this),
        onError: onError,
    };
    this._run(task);

    return;

    function getDocumentationAndInvokeCallbacks() {
        var doc;

        // Find documentation associated with the matched text
        if (!expression.scope) {
            doc = getDocumentation(expression.matchedText);
            if (doc) {
                inspectionResult.doc = doc;
            }

            invokeCallbacks();
            return;
        }

        // Find documentation by searching the chain of constructors
        var task = {
            action: "inspect",
            code: expression.scope,
            beforeRun: beforeRun,
            onSuccess: function(result) {
                var constructorList = result.inspection.constructorList;
                if (constructorList) {
                    for (var i in constructorList) {
                        var constructorName = constructorList[i];
                        doc = getDocumentation(
                            constructorName +
                            ".prototype." +
                            expression.selector
                        );
                        if (doc) {
                            inspectionResult.doc = doc;
                            break;
                        }
                    }
                }

                invokeCallbacks();
            },
            onError: onError,
        };
        this._run(task);
    }

    function invokeCallbacks() {
        if (onInspectionSuccess) {
            onInspectionSuccess(inspectionResult);
        }

        if (afterRun) {
            afterRun();
        }
    }
};

/**
 * Kill session
 *
 * @param {String}              [signal="SIGTERM"] Signal passed to kill the
 *                                                 session server
 * @param {module:nel~KillCB}   [killCB]           Callback run after the
 *                                                 session server has been
 *                                                 killed
 */
Session.prototype.kill = function(signal, killCB) {
    this._killed = true;
    this._server.removeAllListeners();
    this._server.kill(signal || "SIGTERM");
    this._server.on("exit", (function(code, signal) {
        if (killCB) {
            killCB(code, signal);
        }
    }).bind(this));
};

/**
 * Restart session
 *
 * @param {String}               [signal="SIGTERM"] Signal passed to kill the
 *                                                  old session
 * @param {module:nel~RestartCB} [restartCB]        Callback run after restart
 */
Session.prototype.restart = function(signal, restartCB) {
    this.kill(signal || "SIGTERM", (function(code, signal) {
        Session.call(this, this._config);
        if (restartCB) {
            restartCB(code, signal);
        }
    }).bind(this));
};

/**
 * List of Javascript reserved words (ecma-262)
 * @member {RegExp}
 * @private
 */
var javascriptKeywords = [
    // keywords
    "break", "case", "catch", "continue", "debugger", "default",
    "delete", "do", "else", "finally", "for", "function", "if",
    "in", "instanceof", "new", "return", "switch", "this",
    "throw", "try", "typeof", "var", "void", "while", "with",
    // future reserved words
    "class", "const", "enum", "export", "extends", "import",
    "super",
    // future reserved words in strict mode
    "implements", "interface", "let", "package", "private",
    "protected", "public", "static", "yield",
    // null literal
    "null",
    // boolean literals
    "true", "false"
];

/**
 * RegExp for whitespace
 * @member {RegExp}
 * @private
 */
var whitespaceRE = /\s/;

/**
 * RegExp for a simple identifier in Javascript
 * @member {RegExp}
 * @private
 */
var simpleIdentifierRE = /[_$a-zA-Z][_$a-zA-Z0-9]*$/;

/**
 * RegExp for a complex identifier in Javascript
 * @member {RegExp}
 * @private
 */
var complexIdentifierRE = /[_$a-zA-Z][_$a-zA-Z0-9]*(?:[_$a-zA-Z][_$a-zA-Z0-9]*|\.[_$a-zA-Z][_$a-zA-Z0-9]*|\[".*"\]|\['.*'\])*$/;

/**
 * Javascript expression
 *
 * @typedef Expression
 *
 * @property {String} matchedText Matched expression, e.g. `foo["bar`
 * @property {String} scope       Scope of the matched property, e.g. `foo`
 * @property {String} leftOp      Left-hand-side selector operator, e.g. `["`
 * @property {String} selector    Stem of the property being matched, e.g. `bar`
 * @property {String} rightOp     Right-hand-side selector operator, e.g. `"]`
 *
 * @see {@link module:nel~parseExpression}
 * @private
 */

/**
 * Parse a Javascript expression
 *
 * @param {String} code       Javascript code
 * @param {Number} cursorPos  Cursor position within `code`
 *
 * @returns {module:nel~Expression}
 *
 * @todo Parse expressions with parenthesis
 * @private
 */
function parseExpression(code, cursorPos) {
    var expression = code.slice(0, cursorPos);
    if (!expression ||
        whitespaceRE.test(expression[expression.length - 1])) {
        return {
            matchedText: "",
            scope: "",
            leftOp: "",
            selector: "",
            rightOp: "",
        };
    }

    var selector;
    var re = simpleIdentifierRE.exec(expression);
    if (re === null) {
        selector = "";
    } else {
        selector = re[0];
        expression = expression.slice(0, re.index);
    }

    var leftOp;
    var rightOp;
    if (expression[expression.length - 1] === '.') {
        leftOp = ".";
        rightOp = "";
        expression = expression.slice(0, expression.length - 1);
    } else if (
        (expression[expression.length - 2] === '[') &&
        (expression[expression.length - 1] === '"')
    ) {
        leftOp = "[\"";
        rightOp = "\"]";
        expression = expression.slice(0, expression.length - 2);
    } else if (
        (expression[expression.length - 2] === '[') &&
        (expression[expression.length - 1] === '\'')
    ) {
        leftOp = "['";
        rightOp = "']";
        expression = expression.slice(0, expression.length - 2);
    } else {
        return {
            matchedText: code.slice(expression.length, cursorPos),
            scope: "",
            leftOp: "",
            selector: selector,
            rightOp: "",
        };
    }

    var scope;
    re = complexIdentifierRE.exec(expression);
    if (re) {
        scope = re[0];
        return {
            matchedText: code.slice(re.index, cursorPos),
            scope: scope,
            leftOp: leftOp,
            selector: selector,
            rightOp: rightOp,
        };
    } else if (!leftOp) {
        scope = "";
        return {
            matchedText: code.slice(expression.length, cursorPos),
            scope: scope,
            leftOp: leftOp,
            selector: selector,
            rightOp: rightOp,
        };
    }

    // Not implemented
    return null;
}

/**
 * Javascript documentation
 *
 * @typedef Documentation
 *
 * @property {String} description Description
 * @property {String} [usage]     Usage
 * @property {String} url         Link to documentation source
 * @private
 */

/**
 * Get Javascript documentation
 *
 * @param {String} name Javascript name
 *
 * @returns {?module:parser~Documentation}
 * @private
 */
function getDocumentation(name) {
    var builtinName = name;
    if (builtinName in doc) {
        return doc[builtinName];
    }

    builtinName = name.replace(/^[a-zA-Z]+Error./, "Error.");
    if (builtinName in doc) {
        return doc[builtinName];
    }

    builtinName = name.replace(/^[a-zA-Z]+Array./, "TypedArray.");
    if (builtinName in doc) {
        return doc[builtinName];
    }

    return null;
}