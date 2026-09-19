window.__ModuleLoader__.load({
  id: 'context-editor-deepseek-harness',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region node_modules/zod/v4/core/core.js
		var _a$1;
		function $constructor(name, initializer, params) {
			function init(inst, def) {
				if (!inst._zod) Object.defineProperty(inst, "_zod", {
					value: {
						def,
						constr: _,
						traits: /* @__PURE__ */ new Set()
					},
					enumerable: false
				});
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				const proto = _.prototype;
				const keys = Object.keys(proto);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				var _a;
				const inst = params?.Parent ? new Definition() : this;
				init(inst, def);
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				for (const fn of inst._zod.deferred) fn();
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region node_modules/zod/v4/core/util.js
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
		function defineLazy(object, key, getter) {
			let value = void 0;
			Object.defineProperty(object, key, {
				get() {
					if (value === EVALUATING) return;
					if (value === void 0) {
						value = EVALUATING;
						value = getter();
					}
					return value;
				},
				set(v) {
					Object.defineProperty(object, key, { value: v });
				},
				configurable: true
			});
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) {
				const descriptors = Object.getOwnPropertyDescriptors(def);
				Object.assign(mergedDescriptors, descriptors);
			}
			return Object.defineProperties({}, mergedDescriptors);
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -Number.MAX_VALUE, Number.MAX_VALUE;
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function finalizeIssue(iss, ctx, config) {
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
			rest.path ?? (rest.path = []);
			rest.message = message;
			if (ctx?.reportInput) rest.input = _input;
			return rest;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		//#endregion
		//#region node_modules/zod/v4/core/errors.js
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			Object.defineProperty(inst, "_zod", {
				value: inst._zod,
				enumerable: false
			});
			Object.defineProperty(inst, "issues", {
				value: def,
				enumerable: false
			});
			inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
			Object.defineProperty(inst, "toString", {
				value: () => inst.message,
				enumerable: false
			});
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) {
				fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
				fieldErrors[sub.path[0]].push(mapper(sub));
			} else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
							else {
								curr[el] = curr[el] || { _errors: [] };
								curr[el]._errors.push(mapper(issue));
							}
							curr = curr[el];
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region node_modules/zod/v4/core/parse.js
		const _parse = (_Err) => (schema, value, _ctx, _params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			if (result.issues.length) {
				const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, _params?.callee);
				throw e;
			}
			return result.value;
		};
		const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			if (result.issues.length) {
				const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, params?.callee);
				throw e;
			}
			return result.value;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? {
				success: false,
				error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? {
				success: false,
				error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
		const _encode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parse(_Err)(schema, value, ctx);
		};
		const _decode = (_Err) => (schema, value, _ctx) => {
			return _parse(_Err)(schema, value, _ctx);
		};
		const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parseAsync(_Err)(schema, value, ctx);
		};
		const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _parseAsync(_Err)(schema, value, _ctx);
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
				if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
				if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.minimum = def.length;
				bag.maximum = def.length;
				bag.length = def.length;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				const length = input.length;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
		//#endregion
		//#region node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const checks = [...inst._zod.def.checks ?? []];
			if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
			defineLazy(inst, "~standard", () => ({
				validate: (value) => {
					try {
						const r = safeParse$1(inst, value);
						return r.success ? { value: r.data } : { issues: r.error?.issues };
					} catch (_) {
						return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
					}
				},
				vendor: "zod",
				version: 1
			}));
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = Array(input.length);
				const proms = [];
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else handleArrayResult(result, payload, i);
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "values", () => {
				if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazy(inst._zod, "pattern", () => {
				if (def.options.every((o) => o._zod.pattern)) {
					const patterns = def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				for (const key of sharedKeys) {
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
				unrecIssue ?? (unrecIssue = iss);
				for (const k of iss.keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k).l = true;
				}
			} else result.issues.push(iss);
			for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).r = true;
			}
			else result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length && unrecIssue) result.issues.push({
				...unrecIssue,
				keys: bothKeys
			});
			if (aborted(result)) return result;
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			result.value = merged.data;
			return result;
		}
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				payload.fallback = true;
				return payload;
			};
		});
		function handleOptionalResult(result, input) {
			if (input === void 0 && (result.issues.length || result.fallback)) return {
				issues: [],
				value: void 0
			};
			return result;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.optout = "optional";
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
			});
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (def.innerType._zod.optin === "optional") {
					const input = payload.value;
					const result = def.innerType._zod.run(payload, ctx);
					if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
					return handleOptionalResult(result, input);
				}
				if (payload.value === void 0) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => {
				const v = def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => {
					payload.value = result.value;
					if (result.issues.length) {
						payload.value = def.catchValue({
							...payload,
							error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
							input: payload.value
						});
						payload.issues = [];
						payload.fallback = true;
					}
					return payload;
				});
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
					payload.fallback = true;
				}
				return payload;
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => def.in._zod.values);
			defineLazy(inst._zod, "optin", () => def.in._zod.optin);
			defineLazy(inst._zod, "optout", () => def.out._zod.optout);
			defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.length) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues,
				fallback: left.fallback
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
			defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

		Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) {
				if (ctx.target === "draft-2020-12") result.$defs = defs;
				else result.definitions = defs;
			}
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		//#endregion
		//#region node_modules/zod/v4/classic/errors.js
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			Object.defineProperties(inst, {
				format: { value: (mapper) => formatError(inst, mapper) },
				flatten: { value: (mapper) => flattenError(inst, mapper) },
				addIssue: { value: (issue) => {
					inst.issues.push(issue);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				addIssues: { value: (issues) => {
					inst.issues.push(...issues);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				isEmpty: { get() {
					return inst.issues.length === 0;
				} }
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
		//#endregion
		//#region node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region node_modules/zod/v4/classic/schemas.js
		const _installedGroups = /* @__PURE__ */ new WeakMap();
		function _installLazyMethods(inst, group, methods) {
			const proto = Object.getPrototypeOf(inst);
			let installed = _installedGroups.get(proto);
			if (!installed) {
				installed = /* @__PURE__ */ new Set();
				_installedGroups.set(proto, installed);
			}
			if (installed.has(group)) return;
			installed.add(group);
			for (const key in methods) {
				const fn = methods[key];
				Object.defineProperty(proto, key, {
					configurable: true,
					enumerable: false,
					get() {
						const bound = fn.bind(this);
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: bound
						});
						return bound;
					},
					set(v) {
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: v
						});
					}
				});
			}
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			$ZodType.init(inst, def);
			Object.assign(inst["~standard"], { jsonSchema: {
				input: createStandardJSONSchemaMethod(inst, "input"),
				output: createStandardJSONSchemaMethod(inst, "output")
			} });
			inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
			inst.def = def;
			inst.type = def.type;
			Object.defineProperty(inst, "_def", { value: def });
			inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
			inst.safeParse = (data, params) => safeParse(inst, data, params);
			inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
			inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
			inst.spa = inst.safeParseAsync;
			inst.encode = (data, params) => encode(inst, data, params);
			inst.decode = (data, params) => decode(inst, data, params);
			inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
			inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
			inst.safeEncode = (data, params) => safeEncode(inst, data, params);
			inst.safeDecode = (data, params) => safeDecode(inst, data, params);
			inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
			inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
			_installLazyMethods(inst, "ZodType", {
				check(...chks) {
					const def = this.def;
					return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
						check: ch,
						def: { check: "custom" },
						onattach: []
					} } : ch)] }), { parent: true });
				},
				with(...chks) {
					return this.check(...chks);
				},
				clone(def, params) {
					return clone(this, def, params);
				},
				brand() {
					return this;
				},
				register(reg, meta) {
					reg.add(this, meta);
					return this;
				},
				refine(check, params) {
					return this.check(refine(check, params));
				},
				superRefine(refinement, params) {
					return this.check(superRefine(refinement, params));
				},
				overwrite(fn) {
					return this.check(/* @__PURE__ */ _overwrite(fn));
				},
				optional() {
					return optional(this);
				},
				exactOptional() {
					return exactOptional(this);
				},
				nullable() {
					return nullable(this);
				},
				nullish() {
					return optional(nullable(this));
				},
				nonoptional(params) {
					return nonoptional(this, params);
				},
				array() {
					return array(this);
				},
				or(arg) {
					return union([this, arg]);
				},
				and(arg) {
					return intersection(this, arg);
				},
				transform(tx) {
					return pipe(this, transform(tx));
				},
				default(d) {
					return _default(this, d);
				},
				prefault(d) {
					return prefault(this, d);
				},
				catch(params) {
					return _catch(this, params);
				},
				pipe(target) {
					return pipe(this, target);
				},
				readonly() {
					return readonly(this);
				},
				describe(description) {
					const cl = this.clone();
					globalRegistry.add(cl, { description });
					return cl;
				},
				meta(...args) {
					if (args.length === 0) return globalRegistry.get(this);
					const cl = this.clone();
					globalRegistry.add(cl, args[0]);
					return cl;
				},
				isOptional() {
					return this.safeParse(void 0).success;
				},
				isNullable() {
					return this.safeParse(null).success;
				},
				apply(fn) {
					return fn(this);
				}
			});
			Object.defineProperty(inst, "description", {
				get() {
					return globalRegistry.get(inst)?.description;
				},
				configurable: true
			});
			return inst;
		});
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
			_installLazyMethods(inst, "ZodArray", {
				min(n, params) {
					return this.check(/* @__PURE__ */ _minLength(n, params));
				},
				nonempty(params) {
					return this.check(/* @__PURE__ */ _minLength(1, params));
				},
				max(n, params) {
					return this.check(/* @__PURE__ */ _maxLength(n, params));
				},
				length(n, params) {
					return this.check(/* @__PURE__ */ _length(n, params));
				},
				unwrap() {
					return this.element;
				}
			});
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				payload.value = output;
				payload.fallback = true;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		//#endregion
		//#region adapters/deepseek-harness/typert.js
		/** Hand-authored Typert host contribution for the prebuilt plugin package. */
		const PACKAGE_NAME = "context-editor-deepseek-harness";
		const methods = Object.freeze([
			"getSnapshot",
			"getCompatibility",
			"runCompatibilityCheck",
			"getOperation",
			"previewRecovery",
			"createRecoveryBranch",
			"listRecords",
			"getRecord",
			"searchRecords",
			"getSearchMatch",
			"previewContext",
			"previewReplacement",
			"commitContext",
			"commitView",
			"undoView",
			"commitReplacement",
			"restoreReplacement",
			"undoReplacement"
		]);
		const descriptors = Object.freeze(methods.map((method) => {
			const requestType = `${PACKAGE_NAME}#contextEditor/${method}:request`;
			const resultType = `${PACKAGE_NAME}#contextEditor/${method}:result`;
			return {
				id: `${PACKAGE_NAME}#${method}`,
				service: "contextEditor",
				namespace: "contextEditor",
				method,
				invocation: { kind: "direct" },
				parameters: [{
					name: "request",
					wire: "request",
					source: "json",
					codec: {
						mode: "strict",
						typeSymbol: requestType,
						schema: unknown(),
						create: () => unknown()
					}
				}],
				result: {
					mode: "strict",
					typeSymbol: resultType,
					schema: unknown(),
					create: () => unknown()
				}
			};
		}));
		Object.freeze({
			package: PACKAGE_NAME,
			face: "host",
			schemas: [],
			model: {
				services: [{
					key: "contextEditor",
					exportName: "ContextEditorHost",
					members: methods.map((name) => ({
						kind: "method",
						name,
						signature: "(request: unknown) => Promise<unknown>"
					})),
					types: [],
					tags: []
				}],
				events: [],
				objects: []
			},
			invocations: descriptors
		});
		//#endregion
		//#region adapters/deepseek-harness/remote.js
		/**
		* Client-facing Remote contribution.  The official Harness client mounts this
		* descriptor table through `ctx.remote.$mount()`; no browser code reaches the
		* Host by importing the Host service.
		*/
		const contextEditorRemote = Object.freeze({
			package: PACKAGE_NAME,
			descriptors
		});
		//#endregion
		//#region adapters/deepseek-harness/locale.js
		function detectHarnessLocale(source = globalThis) {
			return [...source.navigator?.languages ?? [], source.navigator?.language].filter((value) => typeof value === "string" && value.length > 0).some((value) => value.toLowerCase().startsWith("zh")) ? "zh" : "en";
		}
		function createHarnessText(locale) {
			const zh = locale === "zh";
			const kind = (value) => zh ? value === "ai" ? "AI" : value === "tool" ? "工具" : "用户" : value === "ai" ? "AI" : value === "tool" ? "Tool" : "User";
			const unitKind = (value) => zh ? value === "reasoning" ? "思考" : value === "answer" ? "回答" : value === "tool" ? "工具" : "用户" : value === "reasoning" ? "Reasoning" : value === "answer" ? "Answer" : value === "tool" ? "Tool" : "User";
			const featureUnavailable = (reason) => {
				return {
					"request-transform-unsupported-block": zh ? "所选内容包含尚不支持的格式。其他消息仍可操作。" : "This selection contains an unsupported format. Other messages remain available.",
					"signed-content": zh ? "这段思考带有签名，需要保留原样。" : "This signed reasoning must remain unchanged.",
					"official-surface-has-no-lossless-message-removal": zh ? "此宿主接口不能无损移除模型消息，无法排除上下文。" : "This host API cannot remove model messages losslessly, so context exclusion is unavailable.",
					"assistant-message-surface-replacement-rejected-by-source-reference-contract": zh ? "此宿主不接受 Assistant 消息替换；目前仅支持单条纯文本 User 消息。" : "This host rejects Assistant message replacement; only one plain text User message is supported.",
					"multi-message-summary-restore-not-proven-for-standard-surface": zh ? "尚未验证多消息精简与恢复契约，精简入口已停用。" : "Multi-message condensation and restore are unverified, so condensation is disabled.",
					"host-surface-contract": zh ? "当前宿主只确认单条纯文本 User 消息可替换、恢复和撤销。" : "This host only supports replacing, restoring, and undoing a single plain text User message.",
					"request-transform-plain-text-only": zh ? "目前仅支持完整的纯文本 User 或 Assistant 消息；含思考、工具、图片或签名的消息暂不支持。" : "Only complete plain text User or Assistant messages are supported; reasoning, tools, images, and signatures are not supported.",
					"request-transform-compaction-route": zh ? "请求修改目前需要默认原生压缩，并继承当前会话模型；自定义压缩模型暂不支持。" : "Request editing requires default native compaction inheriting the session model; custom compaction models are not supported.",
					"compaction-behavior-not-included-in-the-synthetic-self-test": zh ? "尚未核验原生压缩的覆盖与恢复行为。" : "Native compaction coverage and restore behavior have not been verified.",
					"host-capability-not-confirmed": zh ? "宿主尚未确认此功能。" : "The host has not confirmed this feature."
				}[reason] ?? (reason || (zh ? "宿主尚未确认此功能。" : "The host has not confirmed this feature."));
			};
			const compatibilitySummary = (report) => {
				const identity = report?.hostIdentity ?? {};
				const features = report?.features ?? {};
				const labels = {
					historyRead: zh ? "历史读取" : "history read",
					search: zh ? "搜索" : "search",
					viewMutation: zh ? "视图状态" : "view state",
					contextExclusion: zh ? "上下文排除" : "context exclusion",
					contextReplacement: zh ? "User 文本替换" : "User text replacement",
					assistantReplacement: zh ? "Assistant 替换" : "Assistant replacement",
					contextCondensation: zh ? "上下文精简" : "context condensation",
					nativeCompaction: zh ? "原生压缩" : "native compaction"
				};
				const available = Object.entries(features).filter(([, feature]) => feature?.available === true).map(([name]) => labels[name] ?? name);
				const gated = Object.entries(features).filter(([, feature]) => feature?.available !== true).map(([name, feature]) => `${labels[name] ?? name}: ${featureUnavailable(feature?.reason)}`);
				const version = identity.components?.["@deepseek-ai/dsh-session"] ?? identity.version ?? "unknown";
				const test = report?.selfTest?.status ?? "not run";
				return zh ? `Harness ${version} · 合成接口自检：${test}（未写入会话）· 可用：${available.join("、") || "无"} · 受限：${gated.join("；") || "无"}` : `Harness ${version} · synthetic API check: ${test} (no session writes) · available: ${available.join(", ") || "none"} · gated: ${gated.join("; ") || "none"}`;
			};
			return {
				more: zh ? "更多" : "More",
				diagnostics: zh ? "诊断" : "Diagnostics",
				details: zh ? "详情" : "Details",
				actionDetails: zh ? "操作说明" : "Action details",
				dismiss: zh ? "关闭提示" : "Dismiss",
				verifyOperation: zh ? "核实状态" : "Verify status",
				nativeProjectionUnsupported: zh ? "当前 Harness 接口限制了部分上下文操作。" : "Some context actions are limited by the current Harness API.",
				featureUnavailable,
				compatibilitySummary,
				runCompatibilityCheck: zh ? "重新检查宿主能力" : "Recheck host capabilities",
				compatibilityChecking: zh ? "正在检查…" : "Checking…",
				compatibilityCheckFailed: (error) => zh ? `能力检查失败：${error}` : `Compatibility check failed: ${error}`,
				condensationPending: zh ? "摘要已生成，尚未应用。点击“应用精简”后，列表才会显示“已应用精简”。" : "Summary generated, not applied yet. Click Apply condensation to show it as applied in the list.",
				condensationConflict: zh ? "上下文已变化，已刷新。请确认选区后重新生成精简。" : "The context changed and has been refreshed. Check your selection and generate again.",
				condensationExpandRelated: zh ? "同步精简 AI 思考和工具输出" : "Also condense AI reasoning and tool outputs",
				condensationExpandedNotice: (count) => zh ? `为保留完整回合，本次精简还包含以下 ${count} 项。应用即确认此范围。` : `To keep complete turns, this summary also includes the following ${count} items. Apply confirms this range.`,
				generateCondensation: zh ? "生成精简" : "Generate summary",
				condensationModelPicker: zh ? "精简模型" : "Condensation model",
				condenseSelected: (count) => zh ? `AI \u7cbe\u7b80${count ? `\uff08${count}\uff09` : ""}` : `AI condense${count ? ` (${count})` : ""}`,
				condensationGenerating: zh ? "正在生成精简摘要…" : "Generating condensation...",
				cancelCondensation: zh ? "取消精简" : "Cancel condensation",
				regenerateCondensation: zh ? "重新生成" : "Regenerate",
				condensationTitle: zh ? "AI 精简上下文" : "AI condense context",
				condensationSummary: zh ? "精简摘要" : "Condensation summary",
				condensationOriginal: zh ? "展开原文范围" : "Show original selected range",
				applyCondensation: zh ? "应用精简" : "Apply condensation",
				restoreCondensation: zh ? "恢复到精简前的新分支" : "Recover to a new branch",
				createRecoveryBranch: zh ? "创建恢复分支" : "Create recovery branch",
				recoveryPreview: (count, retained) => zh ? `将在新分支恢复此前的 ${count} 条消息。之后的 ${retained} 条消息保留在原会话。下面是恢复位置附近的用户消息。继续？` : `Restore the earlier ${count} messages in a new branch. The later ${retained} messages stay in the original session. The nearby user message is shown below. Continue?`,
				recoveryCreated: zh ? "恢复分支已核实并保存。" : "Recovery branch verified and saved.",
				recoveryUnavailable: (reason) => zh ? `\u65e0\u6cd5\u6062\u590d\uff1a${reason}` : `Recovery is unavailable: ${reason}`,
				nativeCompactionRecovery: zh ? "原生压缩恢复" : "Native compaction recovery",
				nativeCompactionCheckpoint: (value) => zh ? `\u538b\u7f29\u68c0\u67e5\u70b9\uff1a${Number(value)}` : `Compaction checkpoint: ${Number(value)}`,
				activeCondensation: zh ? "已应用精简" : "Applied condensation",
				activeCondensations: zh ? "已应用的精简摘要" : "Applied condensations",
				condensationSource: (count, expanded) => zh ? `\u539f\u6587\u8303\u56f4\uff1a${count} \u4e2a\u5355\u5143${expanded ? `（\u81ea\u52a8\u6269\u5c55 ${expanded} \u4e2a）` : ""}` : `Source range: ${count} units${expanded ? ` (${expanded} auto-expanded)` : ""}`,
				condensationFirstChange: (value) => zh ? `\u9996\u6b21\u53d8\u5316\u4f4d\u7f6e\uff1a${value}` : `First changed root: ${value}`,
				condensationModel: (provider, model) => `${provider ?? ""} / ${model ?? ""}`,
				condensationBefore: (value) => zh ? `\u539f\u6587\u4f30\u7b97 token\uff1a${Number(value) || 0}` : `Original estimate: ${Number(value) || 0} tokens`,
				condensationPrefix: (value) => zh ? `\u672a\u6539\u53d8\u524d\u7f00\u4f30\u7b97 token\uff1a${Number(value) || 0}` : `Unchanged prefix estimate: ${Number(value) || 0} tokens`,
				condensationPrefixNotReused: zh ? "已切换精简模型，本次生成未复用会话前缀" : "The selected model differs; this generation did not reuse the session prefix.",
				condensationAfter: (value) => zh ? `\u6458\u8981\u4f30\u7b97 token\uff1a${Number(value) || 0}` : `Summary estimate: ${Number(value) || 0} tokens`,
				condensationSaved: (saved, ratio) => zh ? `\u9884\u8ba1\u8282\u7701\uff1a${Number(saved) || 0} token\uff08${Math.round((Number(ratio) || 0) * 100)}%\uff09` : `Estimated savings: ${Number(saved) || 0} tokens (${Math.round((Number(ratio) || 0) * 100)}%)`,
				condensationCoverage: (status, covered, total) => {
					return `${status === "full" ? zh ? "完全被原生压缩覆盖" : "Fully covered by native compaction" : status === "partial" ? zh ? "部分被原生压缩覆盖" : "Partially covered by native compaction" : zh ? "尚未被原生压缩吸收" : "Not covered by native compaction"} (${Number(covered) || 0}/${Number(total) || 0})`;
				},
				condensationCheckpoint: (value) => zh ? `\u539f\u751f\u538b\u7f29\u5df2\u66ff\u6362\u539f\u6587\uff0c\u8bf7\u5148\u901a\u8fc7\u5bbf\u4e3b\u7684\u5206\u652f/\u68c0\u67e5\u70b9\u5165\u53e3\u8fd4\u56de\u538b\u7f29\u524d\u68c0\u67e5\u70b9${Number.isSafeInteger(Number(value)) ? `\uff08\u5e8f\u53f7 ${Number(value)}\uff09` : ""}\u540e\u518d\u6062\u590d\u3002` : `Native compaction replaced the original range. Use the host branch/checkpoint entry to return to the pre-compaction checkpoint${Number.isSafeInteger(Number(value)) ? ` (event ${Number(value)})` : ""} before restoring.`,
				condensationRestoreUnavailable: zh ? "原生压缩已覆盖该范围，当前无可证明的检查点，暂不能直接恢复。" : "Native compaction covered this range, but no verifiable checkpoint is available for direct restore.",
				condensationLowSaving: zh ? "本次精简收益较小：缩短不足 40% 或节省不足 500 个估算 token，可重新生成或手动删减。" : "Small reduction: under 40% or fewer than 500 estimated tokens saved. Consider regenerating or editing.",
				condensationRisks: (risks) => zh ? `\u98ce\u9669\u63d0\u793a\uff1a${risks}` : `Risks: ${risks}`,
				condensationHint: zh ? "可手动调整摘要；Ctrl/Cmd+Enter 应用，Esc 取消。生成或应用期间主会话保持不变。" : "You can edit the summary. Ctrl/Cmd+Enter applies it; Esc cancels. The main session stays unchanged while generating.",
				condensationFailed: (error) => zh ? `\u7cbe\u7b80\u5931\u8d25\uff1a${error}` : `Condensation failed: ${error}`,
				locale,
				kind,
				unitKind,
				empty: zh ? "（空记录）" : "(empty record)",
				mixedPlaceholder: zh ? "部分内容不可用（原位置占位）" : "Part of this content is unavailable (placeholder at original position)",
				hiddenPlaceholder: (unit) => zh ? `${unitKind(unit)}已隐藏（原位置占位）` : `${unitKind(unit)} hidden (placeholder at original position)`,
				partiallyHidden: zh ? "部分隐藏" : "Partially hidden",
				hidden: zh ? "隐藏" : "Hidden",
				restore: zh ? "恢复" : "Restore",
				excludeContext: zh ? "排除上下文" : "Exclude context",
				restoreContext: zh ? "恢复上下文" : "Restore context",
				contextState: (state) => state === "exclude" ? zh ? "已排除上下文" : "Excluded from context" : state === "mixed" ? zh ? "部分排除" : "Partially excluded" : zh ? "不可用" : "Unavailable",
				excludeSelected: (count) => zh ? `\u6392\u9664\u9009\u4e2d${count ? `（${count}）` : ""}` : `Exclude selected${count ? ` (${count})` : ""}`,
				restoreContextSelected: zh ? "恢复选中上下文" : "Restore selected context",
				contextPreview: (before, after, delta, closureCount) => {
					const beforeValue = Number.isFinite(Number(before)) ? Number(before) : 0;
					const afterValue = Number.isFinite(Number(after)) ? Number(after) : 0;
					const deltaValue = Number.isFinite(Number(delta)) ? Number(delta) : afterValue - beforeValue;
					const sign = deltaValue > 0 ? "+" : "";
					const closure = closureCount > 0 ? zh ? ` · \u8fde\u5e26\u5355\u5143 ${closureCount} \u4e2a` : ` · ${closureCount} related units` : "";
					return zh ? `\u9884\u8ba1\u4e0a\u4e0b\u6587 token：${beforeValue} → ${afterValue}（${sign}${deltaValue}）${closure}。\u786e\u5b9a\u63d0\u4ea4\uff1f` : `Estimated context tokens: ${beforeValue} → ${afterValue} (${sign}${deltaValue})${closure}. Continue?`;
				},
				showHidden: zh ? "显示隐藏内容" : "Show hidden content",
				searchPlaceholder: zh ? "搜索：用户消息和 AI 回答…" : "Search user messages and AI answers…",
				searchPlaceholderForScope: (scope) => zh ? scope === "all" ? "搜索：全文…" : "搜索：用户消息和 AI 回答…" : scope === "all" ? "Search full history…" : "Search user messages and AI answers…",
				searchAria: zh ? "搜索上下文" : "Search context",
				searchFailed: (error) => zh ? `\u641c\u7d22\u5931\u8d25：${error}` : `Search failed: ${error}`,
				searchSummary: (total, occurrences, current, index, active = false, scope = "dialogue") => {
					const scopeLabel = scope === "all" ? zh ? "全文" : "full" : zh ? "对话" : "dialogue";
					if (!active) return zh ? `\u641c\u7d22\u8303\u56f4：${scopeLabel}` : `Search scope: ${scopeLabel}`;
					if (!total) return zh ? `0 \u4e2a\u5355\u5143 · 0 \u4e2a\u547d\u4e2d · ${scopeLabel}` : `0 units · 0 matches · ${scopeLabel}`;
					const currentPart = current === void 0 ? "" : zh ? ` · \u5f53\u524d\u5355\u5143 ${current} \u4e2a\u547d\u4e2d` : ` · ${current} matches in current unit`;
					const indexPart = zh ? ` · ${index + 1}/${total}` : ` · ${index + 1}/${total}`;
					return zh ? `${total} \u4e2a\u5355\u5143 · ${occurrences} \u4e2a\u547d\u4e2d${currentPart}${indexPart} · ${scopeLabel}` : `${total} units · ${occurrences} matches${currentPart}${indexPart} · ${scopeLabel}`;
				},
				searchScope: (scope) => scope === "all" ? zh ? "搜索范围：全文" : "Full search" : zh ? "搜索范围：对话" : "Dialogue search",
				previous: zh ? "上一条" : "Previous",
				next: zh ? "下一条" : "Next",
				hideSelected: (count) => zh ? `隐藏选中${count ? `（${count}）` : ""}` : `Hide selected${count ? ` (${count})` : ""}`,
				restoreSelected: zh ? "恢复选中" : "Restore selected",
				restoreAll: zh ? "恢复全部" : "Restore all",
				undo: zh ? "撤销" : "Undo",
				running: zh ? "Agent 运行中：仅可读取和搜索" : "Agent running: only reading and searching are available",
				loading: zh ? "正在加载会话…" : "Loading session…",
				loadingMore: zh ? "正在加载更多记录…" : "Loading more history…",
				unloadedHistory: (count) => zh ? `中间还有 ${Number(count) || 0} 条未加载记录` : `${Number(count) || 0} history records between these items are not loaded`,
				loadMoreHistory: (loaded, total) => zh ? `加载更多记录（${Number(loaded) || 0}/${Number(total) || 0}）` : `Load more history (${Number(loaded) || 0}/${Number(total) || 0})`,
				noRecords: zh ? "没有符合当前筛选的可编辑记录。" : "No editable records match the current filters.",
				edit: zh ? "编辑" : "Edit",
				edited: zh ? "已编辑" : "Edited",
				restoreOriginal: zh ? "恢复原文" : "Restore original",
				undoReplacement: zh ? "撤销本次编辑" : "Undo this edit",
				compareOriginal: zh ? "对照原文" : "Compare original",
				showEffective: zh ? "显示编辑文本" : "Show edited text",
				originalText: zh ? "原文" : "Original text",
				editTitle: (kind) => zh ? `编辑${unitKind(kind)}` : `Edit ${unitKind(kind)}`,
				cancel: zh ? "取消" : "Cancel",
				save: zh ? "保存" : "Save",
				replacementEmpty: zh ? "编辑内容不能为空或全为空白。" : "Replacement text cannot be blank.",
				replacementConflict: zh ? "会话已发生变化，已丢弃过期编辑并刷新。" : "The session changed; the stale edit was discarded and the view refreshed.",
				replacementUnavailable: (reason) => {
					const labels = {
						"structured-user-content": zh ? "用户消息包含结构化内容" : "the user message contains structured content",
						"signed-content": zh ? "回答包含签名内容" : "the answer contains signed content",
						"projection-unavailable": zh ? "Provider 投影暂不可用" : "provider projection is unavailable",
						"unsupported-unit-kind": zh ? "该单元类型不支持编辑" : "this unit type does not support editing",
						"invalid-target": zh ? "原文已变化，无法安全编辑" : "the canonical text changed and cannot be edited safely",
						"request-transform-plain-text-only": zh ? "仅支持完整的纯文本消息，不能包含思考、工具、图片或签名" : "only complete plain text messages without reasoning, tools, images, or signatures are supported",
						"associated-reasoning-unavailable": zh ? "关联的本轮思考或工具链无法安全投影" : "the associated reasoning or tool chain cannot be projected safely",
						"condensation-active": zh ? "摘要已生效，请先恢复精简前内容" : "condensation is active; restore it before editing"
					};
					return zh ? `不可编辑：${labels[reason] ?? "内容类型不支持"}` : `Not editable: ${labels[reason] ?? "this content is not supported"}`;
				},
				replacementDisabled: zh ? "手动上下文编辑尚未启用" : "Manual context editing is not enabled",
				restoreReplacementConfirm: zh ? "确认恢复该单元的原文吗？" : "Restore this unit to its original text?",
				excludeAssociatedReasoning: zh ? "同时从后续上下文中排除本轮思考内容" : "Also exclude this turn's reasoning from later context",
				excludeAssociatedReasoningHint: zh ? "避免旧思考与修改后的回答不一致，可能影响下一次请求的提示词缓存。" : "Prevents stale reasoning from disagreeing with the edited answer; prompt-cache behavior may change.",
				replacementImpactTitle: zh ? "实际影响范围" : "Actual impact",
				replacementImpactExtra: (ids) => zh ? `签名保护会扩展到工具链：${ids}` : `Signature safety expands this to the tool chain: ${ids}`,
				replacementImpactUnits: (ids) => zh ? `将新增排除：${ids}` : `Newly excluded units: ${ids}`,
				replacementImpactDisabled: (reason) => zh ? `联动已禁用：${reason}` : `Linked exclusion disabled: ${reason}`,
				replacementImpactConfirm: zh ? "确认保存" : "Confirm save",
				editFailed: (error) => zh ? `编辑失败：${error}` : `Edit failed: ${error}`,
				operationRecovered: zh ? "已从持久化会话核实上次编辑，修改已生效。" : "The previous edit was verified from durable session history.",
				operationPending: zh ? "上次编辑尚未写入宿主会话；可重试同一操作完成提交。" : "The previous edit has no verified host write yet. Retry the same action to finish it.",
				operationFailed: zh ? "已核实上次操作未写入会话，可重新操作。" : "The previous operation was confirmed absent from the session. You can try again.",
				operationUnverified: zh ? "无法核实上次编辑状态，已暂停新的上下文修改。恢复宿主后重新打开面板再检查。" : "The previous edit could not be verified. New context writes are paused; reopen the panel when the host is available to check again."
			};
		}
		//#endregion
		//#region adapters/deepseek-harness/client-state.js
		const CLIENT_KINDS = Object.freeze([
			"user",
			"ai",
			"tool"
		]);
		const CLIENT_UNIT_KINDS = Object.freeze([
			"user",
			"reasoning",
			"answer",
			"tool"
		]);
		/**
		* Normalize the persisted unit-level filter.  An explicit empty array means
		* that the user intentionally hid every unit and must remain empty.
		*/
		function normalizeEnabledUnitKinds(value, defaults = CLIENT_UNIT_KINDS) {
			if (!Array.isArray(value)) return [...defaults];
			return [...new Set(value.filter((kind) => CLIENT_UNIT_KINDS.includes(kind)))];
		}
		/** Migrate the V1 record-level filter into the V2 unit-level representation. */
		function migrateEnabledKindsToUnits(value, defaults = CLIENT_UNIT_KINDS) {
			if (!Array.isArray(value)) return [...defaults];
			const next = [];
			for (const kind of value) if (kind === "user" || kind === "tool") next.push(kind);
			else if (kind === "ai") next.push("reasoning", "answer");
			return [...new Set(next)];
		}
		function toggleEnabledUnitKind(enabledKinds, kind) {
			if (!CLIENT_UNIT_KINDS.includes(kind)) return [...enabledKinds];
			return enabledKinds.includes(kind) ? enabledKinds.filter((value) => value !== kind) : [...enabledKinds, kind];
		}
		function nextSearchIndex(currentIndex, delta, total) {
			if (!Number.isInteger(total) || total < 1) return 0;
			return ((Number.isInteger(currentIndex) ? currentIndex : 0) + delta + total) % total;
		}
		async function listContextRecordPage(call, cursor, expectedRevision, pageSize = 100) {
			const page = await call("listRecords", {
				pageSize,
				...cursor === void 0 || cursor === null ? {} : { cursor }
			});
			if (expectedRevision !== void 0 && String(page.revision) !== String(expectedRevision)) throw new Error("CONTEXT_EDITOR_HISTORY_CHANGED_DURING_READ");
			const startIndex = Math.max(0, Number.parseInt(String(cursor ?? 0), 10) || 0);
			return {
				...page,
				records: (page.records ?? []).map((record, index) => record && typeof record === "object" ? {
					...record,
					historyIndex: Number.isSafeInteger(record.historyIndex) ? record.historyIndex : startIndex + index
				} : record)
			};
		}
		async function loadContextRecord(call, recordId, expectedRevision) {
			let value;
			try {
				value = await call("getRecord", { recordId });
			} catch (error) {
				if (/Remote method ['"].*getRecord.*unavailable/iu.test(String(error?.message ?? error))) return null;
				throw error;
			}
			if (value?.record == null) return {
				found: false,
				record: null,
				total: value?.total ?? 0
			};
			if (typeof value.revision !== "string" || !Number.isSafeInteger(value.recordIndex)) return null;
			if (expectedRevision !== void 0 && String(value.revision) !== String(expectedRevision)) throw new Error("CONTEXT_EDITOR_HISTORY_CHANGED_DURING_READ");
			return {
				found: true,
				record: {
					...value.record,
					historyIndex: Number.isSafeInteger(value.record.historyIndex) ? value.record.historyIndex : value.recordIndex
				},
				recordIndex: value.recordIndex,
				total: value.total ?? 0,
				revision: value.revision
			};
		}
		async function loadInitialContextRecords(call, attempt = 0) {
			const snapshot = await call("getSnapshot", { includeRecords: false });
			if (snapshot?.recordsIncluded !== false && Array.isArray(snapshot?.records)) return {
				snapshot,
				records: snapshot.records,
				nextCursor: null,
				total: snapshot.records.length
			};
			try {
				const page = await listContextRecordPage(call, void 0, snapshot.revision);
				return {
					snapshot,
					records: page.records ?? [],
					nextCursor: page.nextCursor ?? null,
					total: page.total ?? snapshot.recordCount ?? 0
				};
			} catch (error) {
				if (error?.message === "CONTEXT_EDITOR_HISTORY_CHANGED_DURING_READ" && attempt < 2) return loadInitialContextRecords(call, attempt + 1);
				throw error;
			}
		}
		async function loadContextRecordsThrough(call, recordId, cursor, expectedRevision, initialRecords = []) {
			const records = [...initialRecords];
			let nextCursor = cursor ?? null;
			let total = records.length;
			for (let page = 0; nextCursor !== null && !records.some((record) => record.id === recordId); page += 1) {
				if (page >= 1e5) throw new Error("CONTEXT_EDITOR_HISTORY_PAGE_LIMIT");
				const value = await listContextRecordPage(call, nextCursor, expectedRevision);
				records.push(...value.records ?? []);
				nextCursor = value.nextCursor ?? null;
				total = value.total ?? total;
				if (!(value.records ?? []).length && nextCursor !== null) throw new Error("CONTEXT_EDITOR_HISTORY_PAGE_EMPTY");
			}
			return {
				records,
				nextCursor,
				total,
				found: records.some((record) => record.id === recordId)
			};
		}
		function finiteNumber(value, fallback = 0) {
			return Number.isFinite(Number(value)) ? Number(value) : fallback;
		}
		/**
		* Return the scroll offset that places a target in the middle of the usable
		* viewport.  The usable viewport starts below the sticky Context Editor
		* controls and ends at the scroll container's bottom edge.  The returned
		* value is always clamped to the container's actual scroll range, so short
		* documents and first/last matches naturally degrade to the closest visible
		* position.
		*/
		function computeCenteredScrollTop({ currentScrollTop = 0, scrollHeight = 0, clientHeight = 0, containerTop = 0, containerBottom, controlsBottom = containerTop, targetTop = 0, targetBottom = targetTop, gap = 12 } = {}) {
			const current = finiteNumber(currentScrollTop);
			const height = Math.max(0, finiteNumber(clientHeight));
			const contentHeight = Math.max(0, finiteNumber(scrollHeight));
			const maximum = Math.max(0, contentHeight - height);
			if (maximum === 0) return Math.min(Math.max(current, 0), maximum);
			const top = finiteNumber(containerTop);
			const bottom = finiteNumber(containerBottom, top + height);
			const inset = Math.max(0, finiteNumber(gap, 12));
			const usableTop = Math.max(top, finiteNumber(controlsBottom, top)) + inset;
			const usableBottom = Math.min(bottom, bottom - inset);
			const usableCenter = usableBottom > usableTop ? (usableTop + usableBottom) / 2 : top + height / 2;
			const desired = current + (finiteNumber(targetTop) + finiteNumber(targetBottom, targetTop)) / 2 - usableCenter;
			return Math.min(Math.max(desired, 0), maximum);
		}
		//#endregion
		//#region \0context-editor-client-css
		const style = document.createElement("style");
		style.textContent = ".context-editor {\n  display: flex;\n  flex-direction: column;\n  gap: 0.65rem;\n  height: 100%;\n  box-sizing: border-box;\n  overflow: hidden;\n  min-height: 0;\n  padding: 0.85rem 1rem 1.25rem;\n  color: var(--dsh-fg, var(--foreground, inherit));\n}\n\n.context-editor__controls {\n  flex-shrink: 0;\n  position: sticky;\n  top: 0;\n  z-index: 10;\n  display: grid;\n  gap: 0.55rem;\n  padding: 0.15rem 0 0.65rem;\n  background: var(--dsh-panel-bg, var(--background, var(--dsh-card-bg, #fff)));\n  border-bottom: 1px solid var(--dsh-border, var(--border, #d7dbe2));\n  box-shadow: 0 0.35rem 0.75rem color-mix(in srgb, var(--dsh-shadow, #172033) 12%, transparent);\n}\n\n.context-editor__toolbar,\n.context-editor__searchbar,\n.context-editor__actions,\n.context-editor__compatibility {\n  display: flex;\n  align-items: center;\n  gap: 0.45rem;\n  flex-wrap: wrap;\n}\n\n.context-editor__filters { display: flex; align-items: flex-start; gap: 0.35rem; flex-wrap: wrap; }\n.context-editor__filter-group { display: inline-flex; align-items: flex-start; gap: 0.25rem; }\n.context-editor__subfilters { display: inline-flex; gap: 0.25rem; padding-top: 0.1rem; }\n.context-editor__filter,\n.context-editor__actions button,\n.context-editor__compatibility button,\n.context-editor__searchbar button,\n.context-editor__row button {\n  border: 1px solid var(--dsh-border, var(--border, #d7dbe2));\n  border-radius: 0.45rem;\n  background: var(--dsh-control-bg, var(--background, transparent));\n  color: inherit;\n  padding: 0.28rem 0.55rem;\n  cursor: pointer;\n}\n.context-editor__filter.is-active,\n.context-editor__filter.is-mixed { background: var(--dsh-accent-soft, #e8efff); border-color: var(--dsh-accent, #7190e8); }\n.context-editor__filter.is-mixed { background: linear-gradient(90deg, var(--dsh-accent-soft, #e8efff) 50%, var(--dsh-control-bg, var(--background, transparent)) 50%); }\n.context-editor button:disabled { cursor: not-allowed; opacity: 0.45; }\n.context-editor__toggle { display: inline-flex; align-items: center; gap: 0.3rem; margin-left: auto; }\n.context-editor__searchbar input { flex: 1 1 20rem; min-width: 12rem; border: 1px solid var(--dsh-border, var(--border, #d7dbe2)); border-radius: 0.45rem; padding: 0.38rem 0.55rem; background: var(--dsh-input-bg, transparent); color: inherit; }\n.context-editor__search-summary { color: var(--dsh-muted, #687386); font-size: 0.82rem; }\n.context-editor__compatibility { align-items: flex-start; color: var(--dsh-muted, #687386); font-size: 0.78rem; }\n.context-editor__compatibility span:first-child { flex: 1 1 28rem; overflow-wrap: anywhere; }\n.context-editor__actions { padding-bottom: 0.15rem; }\n.context-editor__running { color: var(--dsh-muted, #687386); font-size: 0.82rem; }\n.context-editor__error { color: var(--dsh-danger, #b42318); font-size: 0.82rem; }\n.context-editor__list { overflow: auto; flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 0.5rem; padding-right: 0.2rem; padding-bottom: 12rem; }\n.context-editor__list > * { flex-shrink: 0; }\n.context-editor__row { display: flex; align-items: flex-start; gap: 0.6rem; border: 1px solid var(--dsh-border, var(--border, #d7dbe2)); border-radius: 0.55rem; padding: 0.65rem; background: var(--dsh-card-bg, transparent); }\n.context-editor__row.is-focused { outline: 2px solid var(--dsh-accent, #7190e8); outline-offset: 1px; }\n.context-editor__row.is-hidden { opacity: 0.82; }\n.context-editor__row--placeholder { align-items: center; min-height: 2.4rem; border-style: dashed; }\n.context-editor__row--placeholder input { margin-top: 0.2rem; }\n.context-editor__placeholder-text { flex: 1; color: var(--dsh-muted, #687386); font-size: 0.9rem; }\n.context-editor__row-content { flex: 1; min-width: 0; }\n.context-editor__row-meta { display: flex; align-items: center; gap: 0.45rem; color: var(--dsh-muted, #687386); font-size: 0.75rem; margin-bottom: 0.35rem; }\n.context-editor__kind { font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }\n.context-editor__hidden-badge { color: var(--dsh-warning, #996b00); }\n.context-editor__context-badge { color: var(--dsh-accent, #4568c4); font-weight: 600; }\n.context-editor__context-badge.is-unavailable { color: var(--dsh-muted, #687386); }\n.context-editor__replacement-badge { color: var(--dsh-accent, #4568c4); font-weight: 600; }\n.context-editor__replacement-reason { color: var(--dsh-muted, #687386); font-size: 0.75rem; }\n.context-editor__replacement-actions { display: inline-flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }\n.context-editor__unit.is-context-excluded { border-color: color-mix(in srgb, var(--dsh-accent, #7190e8) 55%, var(--dsh-border, #d7dbe2)); }\n.context-editor__context-toggle { margin-left: auto; }\n.context-editor__units { display: grid; gap: 0.45rem; }\n.context-editor__unit { border: 1px solid var(--dsh-border, var(--border, #d7dbe2)); border-radius: 0.45rem; padding: 0.45rem 0.55rem; }\n.context-editor__unit.is-focused { outline: 2px solid var(--dsh-accent, #7190e8); outline-offset: 1px; }\n.context-editor__unit.is-hidden { opacity: 0.82; }\n.context-editor__unit-header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; min-height: 1.65rem; color: var(--dsh-muted, #687386); font-size: 0.78rem; }\n.context-editor__unit-select { display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; }\n.context-editor__unit-kind { font-weight: 600; }\n.context-editor__unit-header button { margin-left: auto; }\n.context-editor__unit-header .context-editor__replacement-actions button { margin-left: 0; }\n.context-editor__unit-body { min-width: 0; }\n.context-editor__unit-placeholder { color: var(--dsh-muted, #687386); padding: 0.35rem 0; font-size: 0.9rem; }\n.context-editor__record-body { display: grid; gap: 0.25rem; }\n.context-editor__atom { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }\n.context-editor__atom--reasoning { color: var(--dsh-muted, #687386); }\n.context-editor__tool-name { font-weight: 600; }\n.context-editor__hit { border-radius: 0.18rem; background: var(--dsh-highlight, #ffe28a); color: inherit; padding: 0 0.08rem; }\n.context-editor__state { color: var(--dsh-muted, #687386); padding: 2rem 0; text-align: center; }\n.context-editor__history-load-more { align-self: center; border: 1px solid var(--dsh-border, var(--border, #d7dbe2)); border-radius: 0.45rem; background: var(--dsh-control-bg, var(--background, transparent)); color: inherit; padding: 0.4rem 0.8rem; cursor: pointer; }\n.context-editor__history-gap { padding: 8px 12px; color: var(--dsh-muted, var(--muted, #7a7a7a)); text-align: center; font-size: 0.82em; border-block: 1px dashed var(--dsh-border, var(--border, #d7dbe2)); }\n.context-editor__empty { color: var(--dsh-muted, #687386); }\n.context-editor__notice { color: var(--dsh-warning, #996b00); font-size: 0.82rem; }\n.context-editor__dialog-backdrop {\n  position: fixed;\n  inset: 0;\n  z-index: 100;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 1rem;\n  background: color-mix(in srgb, #0b1220 48%, transparent);\n}\n.context-editor__dialog {\n  width: min(48rem, 100%);\n  max-height: min(42rem, 100%);\n  display: grid;\n  gap: 0.75rem;\n  padding: 1rem;\n  border: 1px solid var(--dsh-border, var(--border, #d7dbe2));\n  border-radius: 0.7rem;\n  background: var(--dsh-panel-bg, var(--background, #fff));\n  color: var(--dsh-fg, var(--foreground, inherit));\n  box-shadow: 0 1rem 3rem color-mix(in srgb, #172033 35%, transparent);\n}\n.context-editor__dialog-header { display: flex; align-items: center; gap: 0.5rem; }\n.context-editor__dialog-header h2 { flex: 1; margin: 0; font-size: 1rem; }\n.context-editor__dialog-close { margin-left: auto; border: 0; background: transparent; color: inherit; font-size: 1.35rem; cursor: pointer; }\n.context-editor__dialog-input {\n  width: 100%;\n  min-height: 14rem;\n  resize: vertical;\n  box-sizing: border-box;\n  border: 1px solid var(--dsh-border, var(--border, #d7dbe2));\n  border-radius: 0.45rem;\n  padding: 0.65rem;\n  background: var(--dsh-input-bg, transparent);\n  color: inherit;\n  font: inherit;\n  line-height: 1.45;\n}\n.context-editor__dialog-hint { color: var(--dsh-muted, #687386); font-size: 0.75rem; }\n.context-editor__dialog-error { color: var(--dsh-danger, #b42318); font-size: 0.82rem; }\n.context-editor__dialog-actions { display: flex; justify-content: flex-end; gap: 0.45rem; }\n.context-editor__dialog-actions button { border: 1px solid var(--dsh-border, var(--border, #d7dbe2)); border-radius: 0.45rem; background: var(--dsh-control-bg, var(--background, transparent)); color: inherit; padding: 0.35rem 0.7rem; cursor: pointer; }\n.context-editor__condensation-action { border-color: var(--dsh-accent, #7190e8) !important; }\n.context-editor__condensation-model { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--dsh-muted, #687386); font-size: 0.78rem; }\n.context-editor__condensation-model select { max-width: 14rem; border: 1px solid var(--dsh-border, var(--border, #d7dbe2)); border-radius: 0.4rem; background: var(--dsh-control-bg, var(--background, transparent)); color: inherit; padding: 0.25rem 0.4rem; }\n.context-editor__condensation-list { display: grid; gap: 0.5rem; }\n.context-editor__condensation-card { display: grid; gap: 0.45rem; padding: 0.65rem; border: 1px solid var(--dsh-accent, #7190e8); border-radius: 0.55rem; background: var(--dsh-accent-soft, #e8efff); }\n.context-editor__condensation-card-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.82rem; }\n.context-editor__condensation-card-header span { color: var(--dsh-muted, #687386); }\n.context-editor__condensation-card-header button { margin-left: auto; border: 1px solid var(--dsh-border, var(--border, #d7dbe2)); border-radius: 0.45rem; background: var(--dsh-control-bg, var(--background, transparent)); color: inherit; padding: 0.25rem 0.5rem; cursor: pointer; }\n.context-editor__condensation-summary { margin: 0; max-height: 10rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.4; }\n.context-editor__condensation-card-metrics,\n.context-editor__condensation-meta,\n.context-editor__condensation-metrics,\n.context-editor__condensation-risks { display: flex; gap: 0.65rem; flex-wrap: wrap; color: var(--dsh-muted, #687386); font-size: 0.8rem; }\n.context-editor__condensation-risks { color: var(--dsh-warning, #996b00); }\n.context-editor__condensation-source { border-top: 1px solid var(--dsh-border, var(--border, #d7dbe2)); padding-top: 0.4rem; }\n.context-editor__condensation-expansion ul { max-height: 8rem; overflow: auto; overflow-wrap: anywhere; margin: 0.4rem 0; }\n.context-editor__condensation-source article { margin-top: 0.45rem; }\n.context-editor__condensation-source pre { margin: 0.25rem 0 0; max-height: 8rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }\n\n@media (max-width: 42rem) {\n  .context-editor__searchbar input { flex-basis: 100%; min-width: 0; }\n  .context-editor__toggle { margin-left: 0; }\n  .context-editor__search-summary { flex: 1 1 100%; }\n}\n\r\n.context-editor__replacement-link { display: flex; align-items: flex-start; gap: 0.45rem; font-size: 0.85rem; }\r\n.context-editor__replacement-link-hint { color: var(--dsh-muted, #687386); font-size: 0.75rem; }\r\n.context-editor__replacement-impact { display: grid; gap: 0.3rem; padding: 0.6rem; border: 1px solid var(--dsh-border, var(--border, #d7dbe2)); border-radius: 0.45rem; font-size: 0.82rem; }\r\n.context-editor__replacement-impact.is-error { border-color: var(--dsh-danger, #b42318); }\n.context-editor__more, .context-editor__details, .context-editor__restriction, .context-editor__recovery-list { font-size: .8rem; min-width: 0; overflow-wrap: anywhere; }\n.context-editor summary { cursor: pointer; color: var(--dsh-muted, #687386); }\n.context-editor summary:focus-visible { outline: 2px solid var(--dsh-accent, #7190e8); outline-offset: 2px; }\n.context-editor__restriction[open] { flex-basis: 100%; }\n.context-editor__compatibility { padding: .45rem; max-height: 16rem; overflow: auto; }\n.context-editor__notice { display: inline-flex; align-items: center; gap: .4rem; flex-wrap: wrap; }\n.context-editor__recovery-list > article { margin-top: .5rem; }\n";
		document.head.appendChild(style);
		//#endregion
		//#region adapters/deepseek-harness/client.js
		/**
		* Browser half of the Context Editor Harness adapter.
		*
		* It contributes a single `conversation.view` tab.  The view owns a
		* per-Session controller, paginates through Host records, and treats every
		* asynchronous response as latest-wins so an old search/page cannot overwrite
		* the current Session state.
		*/
		const inject = ["remote"];
		const h = react.default.createElement;
		const ALL_KINDS = CLIENT_KINDS;
		const ALL_UNIT_KINDS = CLIENT_UNIT_KINDS;
		const condensationModelKey = (model) => `${model?.provider ?? ""}:${model?.id ?? ""}`;
		const PREFS_KEY_V1 = "dsh-context-editor:prefs:v1";
		const PREFS_KEY_V2 = "dsh-context-editor:prefs:v2";
		const PENDING_REPLACEMENT_KEY = "dsh-context-editor:pending-replacement:v1";
		function pendingReplacementStorageKey(sessionId) {
			return `${PENDING_REPLACEMENT_KEY}:${encodeURIComponent(String(sessionId))}`;
		}
		function readPendingReplacement(sessionId) {
			try {
				const value = JSON.parse(globalThis.localStorage?.getItem(pendingReplacementStorageKey(sessionId)) ?? "null");
				if (!value || typeof value.operationId !== "string" || typeof value.unitId !== "string" || ![
					"replace",
					"restore",
					"undo",
					"exclude"
				].includes(value.action)) return null;
				return {
					operationId: value.operationId,
					unitId: value.unitId,
					action: value.action
				};
			} catch {
				return null;
			}
		}
		function writePendingReplacement(sessionId, value) {
			try {
				globalThis.localStorage?.setItem(pendingReplacementStorageKey(sessionId), JSON.stringify({
					operationId: String(value.operationId),
					unitId: String(value.unitId),
					action: value.action
				}));
			} catch {}
		}
		function clearPendingReplacement(sessionId, operationId) {
			try {
				const key = pendingReplacementStorageKey(sessionId);
				const current = readPendingReplacement(sessionId);
				if (operationId === void 0 || current?.operationId === String(operationId)) globalThis.localStorage?.removeItem(key);
			} catch {}
		}
		function unwrap(value) {
			if (value && value.ok === false && value.error !== void 0) {
				const error = new Error(value.error.message ?? value.error.code ?? "Context Editor Remote failed");
				Object.assign(error, value.error);
				throw error;
			}
			if (value && value.ok === true && Object.prototype.hasOwnProperty.call(value, "value")) return value.value;
			return value;
		}
		function safePreferences() {
			const defaults = {
				enabledUnitKinds: [...ALL_UNIT_KINDS],
				showHidden: false
			};
			try {
				const rawV2 = globalThis.localStorage?.getItem(PREFS_KEY_V2);
				if (rawV2) {
					const value = JSON.parse(rawV2);
					if (Array.isArray(value?.enabledUnitKinds)) return {
						enabledUnitKinds: normalizeEnabledUnitKinds(value.enabledUnitKinds, defaults.enabledUnitKinds),
						showHidden: Boolean(value?.showHidden)
					};
				}
				const rawV1 = globalThis.localStorage?.getItem(PREFS_KEY_V1);
				if (rawV1) {
					const value = JSON.parse(rawV1);
					if (Array.isArray(value?.enabledKinds)) return {
						enabledUnitKinds: migrateEnabledKindsToUnits(value.enabledKinds, defaults.enabledUnitKinds),
						showHidden: Boolean(value?.showHidden)
					};
				}
				return defaults;
			} catch {
				return defaults;
			}
		}
		function savePreferences(value) {
			try {
				globalThis.localStorage?.setItem(PREFS_KEY_V2, JSON.stringify(value));
			} catch {}
		}
		function unitsForRecord(record) {
			const atoms = Array.isArray(record?.atoms) ? record.atoms : [];
			const byId = new Map(atoms.map((atom) => [atom.id, atom]));
			if (Array.isArray(record?.units) && record.units.length > 0) return record.units.map((unit) => ({
				...unit,
				atoms: Array.isArray(unit.atoms) && unit.atoms.length > 0 ? unit.atoms : (unit.atomIds ?? []).map((id) => byId.get(id)).filter(Boolean)
			}));
			const kind = record?.kind === "ai" ? "answer" : record?.kind;
			return [{
				id: `${record.id}#${kind}`,
				recordId: record.id,
				kind,
				atomIds: atoms.map((atom) => atom.id),
				atoms,
				viewState: record.viewState,
				mutable: record.mutable,
				projectionState: record.projectionState ?? "include"
			}];
		}
		function highlight(text, match) {
			if (!match || typeof text !== "string") return text;
			const start = Math.max(0, Math.min(text.length, Number(match.start) || 0));
			const end = Math.max(start, Math.min(text.length, Number(match.end) || start));
			return h(react.default.Fragment, null, text.slice(0, start), h("mark", { className: "context-editor__hit" }, text.slice(start, end)), text.slice(end));
		}
		function errorText(error) {
			return error instanceof Error ? error.message : String(error ?? "Unknown error");
		}
		function isScrollableElement(element) {
			if (!element || typeof element.scrollHeight !== "number" || typeof element.clientHeight !== "number") return false;
			if (element.scrollHeight <= element.clientHeight + 1) return false;
			const style = globalThis.getComputedStyle?.(element);
			if (!style) return true;
			const overflowY = style.overflowY || style.overflow || "";
			return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
		}
		function findScrollableContainer(node) {
			let current = node?.parentElement ?? null;
			while (current) {
				if (isScrollableElement(current)) return current;
				current = current.parentElement;
			}
			const documentObject = globalThis.document;
			return documentObject?.scrollingElement ?? documentObject?.documentElement ?? documentObject?.body ?? null;
		}
		function elementRect(element, fallbackHeight = 0) {
			const documentObject = globalThis.document;
			if (element && (element === documentObject?.scrollingElement || element === documentObject?.documentElement || element === documentObject?.body)) return {
				top: 0,
				bottom: Number(globalThis.innerHeight) || Number(documentObject?.documentElement?.clientHeight) || Number(element.clientHeight) || fallbackHeight
			};
			const rect = element?.getBoundingClientRect?.();
			if (rect && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)) return {
				top: rect.top,
				bottom: rect.bottom
			};
			return {
				top: 0,
				bottom: Number.isFinite(Number(element?.clientHeight)) ? Number(element.clientHeight) : fallbackHeight
			};
		}
		function scrollTopOf(element) {
			return Number.isFinite(Number(element?.scrollTop)) ? Number(element.scrollTop) : 0;
		}
		function scrollToTop(element, top, behavior) {
			if (!element) return;
			const options = {
				top,
				left: Number.isFinite(Number(element.scrollLeft)) ? Number(element.scrollLeft) : 0,
				behavior
			};
			if (typeof element.scrollTo === "function") try {
				element.scrollTo(options);
				return;
			} catch {
				try {
					element.scrollTo(0, top);
					return;
				} catch {}
			}
			if (element === globalThis.document?.scrollingElement && typeof globalThis.scrollTo === "function") try {
				globalThis.scrollTo({
					top,
					behavior
				});
				return;
			} catch {}
			try {
				element.scrollTop = top;
			} catch {}
		}
		function enabledRecordKindsForUnits(enabledUnitKinds) {
			const enabled = new Set(enabledUnitKinds);
			return ALL_KINDS.filter((kind) => kind === "ai" ? enabled.has("reasoning") || enabled.has("answer") : enabled.has(kind));
		}
		function unitFilterState(enabledUnitKinds, kind) {
			return enabledUnitKinds.includes(kind) ? "on" : "off";
		}
		function aiFilterState(enabledUnitKinds) {
			const reasoning = enabledUnitKinds.includes("reasoning");
			const answer = enabledUnitKinds.includes("answer");
			if (reasoning && answer) return "on";
			if (!reasoning && !answer) return "off";
			return "mixed";
		}
		/** Thin generated-Remote consumer with no global Session state. */
		var ContextEditorController = class {
			constructor(remote, sessionId) {
				this.remote = remote;
				this.sessionId = String(sessionId);
				this.disposed = false;
				this.listeners = /* @__PURE__ */ new Set();
			}
			dispose() {
				this.disposed = true;
				this.listeners.clear();
			}
			subscribe(listener) {
				if (typeof listener !== "function") throw new TypeError("Context Editor listener must be a function");
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			}
			async callMutation(method, payload = {}) {
				const value = await this.call(method, payload);
				if (value?.ok !== false && value?.conflict !== true) for (const listener of [...this.listeners]) listener({
					method,
					value
				});
				return value;
			}
			async call(method, payload = {}) {
				if (this.disposed) throw new Error("Context Editor controller is disposed");
				const fn = this.remote?.[method];
				if (typeof fn !== "function") throw new Error(`Context Editor Remote method '${method}' is unavailable`);
				return unwrap(await fn({
					sessionId: this.sessionId,
					locator: {
						host: "deepseek-harness",
						sessionId: this.sessionId
					},
					...payload
				}));
			}
			async load(attempt = 0) {
				return loadInitialContextRecords((method, payload) => this.call(method, payload), attempt);
			}
			async loadRecordsPage(cursor, expectedRevision) {
				return listContextRecordPage((method, payload) => this.call(method, payload), cursor, expectedRevision);
			}
			async loadRecord(recordId, expectedRevision) {
				return loadContextRecord((method, payload) => this.call(method, payload), recordId, expectedRevision);
			}
			async loadUntilRecord(recordId, cursor, expectedRevision, initialRecords = []) {
				return loadContextRecordsThrough((method, payload) => this.call(method, payload), recordId, cursor, expectedRevision, initialRecords);
			}
			async search(query, enabledKinds, scope = "dialogue", enabledUnitKinds) {
				return await this.call("searchRecords", {
					query,
					enabledKinds,
					scope,
					...enabledUnitKinds === void 0 ? {} : { enabledUnitKinds }
				});
			}
			async match(searchId, index, revision) {
				return this.call("getSearchMatch", {
					searchId,
					index,
					revision
				});
			}
			async getOperation(operationId) {
				return this.call("getOperation", { operationId });
			}
			async commit(action, baseRevision, unitIds) {
				return this.callMutation("commitView", {
					action,
					baseRevision,
					...unitIds === void 0 ? {} : { unitIds }
				});
			}
			async undo(baseRevision) {
				return this.callMutation("undoView", { baseRevision });
			}
			async previewContext(action, expectedRevision, unitIds, options = {}) {
				return this.call("previewContext", {
					action,
					expectedRevision,
					...unitIds === void 0 ? {} : { unitIds },
					...options.condensationOperationId ? { condensationOperationId: options.condensationOperationId } : {}
				});
			}
			async commitContext(operationId, action, expectedRevision, unitIds, options = {}) {
				return this.callMutation("commitContext", {
					operationId,
					action,
					expectedRevision,
					...options.selectionFingerprint ? { selectionFingerprint: options.selectionFingerprint } : {},
					...unitIds === void 0 ? {} : { unitIds },
					...options.condensationOperationId ? { condensationOperationId: options.condensationOperationId } : {}
				});
			}
			async listCondensationModels() {
				return this.call("previewContext", { action: "condense-models" });
			}
			async generateCondensation(unitIds, baseRevision, options = {}) {
				return this.call("previewContext", {
					action: "condense",
					unitIds,
					baseContextRevision: baseRevision,
					baseRevision,
					...options.operationId ? { operationId: options.operationId } : {},
					...options.provider ? { provider: options.provider } : {},
					...options.model ? { model: options.model } : {},
					expandRelated: options.expandRelated === true,
					...options.maxTokens ? { maxTokens: options.maxTokens } : {}
				});
			}
			async cancelCondensation(operationId) {
				return this.call("previewContext", {
					action: "cancel-condense",
					operationId
				});
			}
			async commitCondensation(proposal, summary) {
				return this.callMutation("commitContext", {
					action: "condense",
					operationId: proposal.operationId,
					baseContextRevision: proposal.baseContextRevision ?? proposal.baseRevision,
					unitIds: proposal.requestedUnitIds,
					summary
				});
			}
			async restoreCondensation(operationId, baseRevision) {
				return this.callMutation("commitContext", {
					action: "restore-condensation",
					operationId,
					baseRevision
				});
			}
			async previewRecovery(request) {
				return this.call("previewRecovery", request);
			}
			async createRecoveryBranch(request) {
				return this.callMutation("createRecoveryBranch", request);
			}
			replacementOperationId(action, unitId) {
				return `context-replacement-${action}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${String(unitId).slice(-12)}`;
			}
			async previewReplacement(unitId, baseContextRevision, text, excludeAssociatedReasoning = false) {
				return this.call("previewReplacement", {
					unitId,
					baseContextRevision,
					baseRevision: baseContextRevision,
					text,
					excludeAssociatedReasoning
				});
			}
			async commitReplacement(unitId, baseContextRevision, text, options = {}) {
				const operationId = options.operationId ?? this.replacementOperationId("replace", unitId);
				return this.callMutation("commitReplacement", {
					operationId,
					unitId,
					baseContextRevision,
					baseRevision: baseContextRevision,
					text,
					...options.excludeAssociatedReasoning ? { excludeAssociatedReasoning: true } : {},
					...options.confirmedUnitIds?.length ? { confirmedUnitIds: options.confirmedUnitIds } : {}
				});
			}
			async restoreReplacement(unitId, baseContextRevision, options = {}) {
				const operationId = options.operationId ?? this.replacementOperationId("restore", unitId);
				return this.callMutation("restoreReplacement", {
					operationId,
					unitId,
					baseContextRevision,
					baseRevision: baseContextRevision
				});
			}
			async undoReplacement(unitId, baseContextRevision, options = {}) {
				const operationId = options.operationId ?? this.replacementOperationId("undo", unitId);
				return this.callMutation("undoReplacement", {
					operationId,
					unitId,
					baseContextRevision,
					baseRevision: baseContextRevision
				});
			}
			async getCompatibility() {
				return this.call("getCompatibility");
			}
			async runCompatibilityCheck() {
				return this.call("runCompatibilityCheck");
			}
		};
		function FilterButton({ kind, state, onClick, text, label }) {
			const enabled = state === "on";
			return h("button", {
				type: "button",
				className: `context-editor__filter ${enabled ? "is-active" : ""} ${state === "mixed" ? "is-mixed" : ""}`,
				"data-filter-kind": kind,
				"data-filter-state": state,
				onClick,
				"aria-pressed": enabled,
				"aria-checked": state,
				role: "checkbox"
			}, label ?? text.kind(kind));
		}
		function UnitBody({ unit, match, text, showOriginal = false }) {
			const atoms = unit.atoms ?? [];
			if (!atoms.length) return h("span", { className: "context-editor__empty" }, text.empty);
			if (unit.kind === "user" || unit.kind === "answer") {
				const value = showOriginal ? atoms.map((atom) => atom.text ?? "").join("\n") : unit.effectiveText ?? atoms.map((atom) => atom.text ?? "").join("\n");
				const anchor = atoms.at(-1)?.id;
				return h("div", { className: "context-editor__record-body" }, h("div", { className: `context-editor__atom context-editor__atom--${unit.kind}` }, h("span", null, !showOriginal && match?.atomId === anchor ? highlight(value, match) : value)));
			}
			return h("div", { className: "context-editor__record-body" }, atoms.map((atom) => {
				const atomMatch = match?.atomId === atom.id && match?.field !== "tool_name";
				const toolName = atom.toolName ? h("span", { className: "context-editor__tool-name" }, `${atom.toolName}: `) : null;
				return h("div", {
					key: atom.id,
					className: `context-editor__atom context-editor__atom--${atom.kind}`
				}, toolName, h("span", null, atomMatch ? highlight(atom.text ?? "", match) : atom.text ?? ""));
			}));
		}
		function EditDialog({ unit, initialText, text, onCancel, onSave }) {
			const [value, setValue] = (0, react.useState)(initialText);
			const [linkReasoning, setLinkReasoning] = (0, react.useState)(false);
			const [impact, setImpact] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)("");
			const [saving, setSaving] = (0, react.useState)(false);
			const textarea = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				setValue(initialText);
				setLinkReasoning(false);
				setImpact(null);
				setError("");
				const timer = globalThis.setTimeout?.(() => textarea.current?.focus?.(), 0);
				return () => {
					if (timer !== void 0) globalThis.clearTimeout?.(timer);
				};
			}, [initialText, unit.id]);
			const submit = async (confirmedUnitIds) => {
				if (saving) return;
				if (value.trim().length === 0) {
					setError(text.replacementEmpty);
					return;
				}
				if (value === initialText && !linkReasoning) {
					onCancel();
					return;
				}
				setSaving(true);
				setError("");
				try {
					await onSave(value, {
						excludeAssociatedReasoning: linkReasoning,
						confirmedUnitIds
					});
					setImpact(null);
				} catch (cause) {
					setSaving(false);
					if (cause?.preview) {
						setImpact(cause.preview);
						setError(cause.preview.disabledReason ?? "");
					} else setError(errorText(cause));
				}
			};
			const onKeyDown = (event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					if (!saving) onCancel();
					return;
				}
				if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
					event.preventDefault();
					submit(impact?.effectiveUnitIds);
				}
			};
			const hasReasoning = !unit.operations && unit.kind === "answer" && (unit.associatedReasoningUnitIds?.length ?? 0) > 0;
			return h("div", { className: "context-editor__dialog-backdrop" }, h("div", {
				className: "context-editor__dialog",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": text.editTitle(unit.kind),
				onKeyDown
			}, h("div", { className: "context-editor__dialog-header" }, h("h2", null, text.editTitle(unit.kind)), h("button", {
				type: "button",
				className: "context-editor__dialog-close",
				disabled: saving,
				onClick: onCancel,
				"aria-label": text.cancel
			}, "×")), h("textarea", {
				ref: textarea,
				className: "context-editor__dialog-input",
				value,
				onChange: (event) => {
					setValue(event.target.value);
					if (impact) setImpact(null);
				},
				spellCheck: false,
				disabled: saving,
				"aria-label": text.editTitle(unit.kind)
			}), hasReasoning ? h("label", { className: "context-editor__replacement-link" }, h("input", {
				type: "checkbox",
				checked: linkReasoning,
				disabled: saving,
				onChange: (event) => {
					setLinkReasoning(event.target.checked);
					setImpact(null);
					setError("");
				}
			}), h("span", null, text.excludeAssociatedReasoning)) : null, hasReasoning ? h("div", { className: "context-editor__replacement-link-hint" }, text.excludeAssociatedReasoningHint) : null, impact ? h("div", {
				className: "context-editor__replacement-impact " + (impact.canCommit ? "" : "is-error"),
				role: impact.canCommit ? "status" : "alert"
			}, h("strong", null, text.replacementImpactTitle), impact.disabledReason ? h("div", null, text.replacementImpactDisabled(impact.disabledReason)) : null, impact.requiresConfirmation ? h("div", null, text.replacementImpactExtra(impact.autoExpandedUnitIds.join(", "))) : null, impact.newlyExcludedUnitIds?.length ? h("div", null, text.replacementImpactUnits(impact.newlyExcludedUnitIds.join(", "))) : null, impact.canCommit && impact.requiresConfirmation ? h("button", {
				type: "button",
				disabled: saving,
				onClick: () => void submit(impact.effectiveUnitIds)
			}, text.replacementImpactConfirm) : null) : null, h("div", { className: "context-editor__dialog-hint" }, "Ctrl/Cmd+Enter", " · ", text.cancel, " Esc"), error ? h("div", {
				className: "context-editor__dialog-error",
				role: "alert"
			}, error) : null, h("div", { className: "context-editor__dialog-actions" }, h("button", {
				type: "button",
				disabled: saving,
				onClick: onCancel
			}, text.cancel), h("button", {
				type: "button",
				disabled: saving,
				onClick: () => void submit(impact?.effectiveUnitIds)
			}, saving ? text.loading : impact?.requiresConfirmation ? text.replacementImpactConfirm : text.save))));
		}
		function CondensationDialog({ proposal, text, onCancel, onRegenerate, onApply, saving, generating, error }) {
			const [value, setValue] = (0, react.useState)(String(proposal?.summary ?? ""));
			const [expandRelated, setExpandRelated] = (0, react.useState)(proposal?.expandRelated === true);
			const scopeChanged = expandRelated !== (proposal?.expandRelated === true);
			const needsGeneration = proposal?.draft === true || scopeChanged;
			const textarea = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				setValue(String(proposal?.summary ?? ""));
				setExpandRelated(proposal?.expandRelated === true);
				const timer = globalThis.setTimeout?.(() => textarea.current?.focus?.(), 0);
				return () => {
					if (timer !== void 0) globalThis.clearTimeout?.(timer);
				};
			}, [proposal?.operationId]);
			const metrics = proposal?.metrics ?? {};
			const risks = Array.isArray(proposal?.risks) ? proposal.risks : [];
			const warnings = Array.isArray(proposal?.warnings) ? proposal.warnings : [];
			const editedAfter = Math.ceil(`<condensed-context>\n${value.trim()}\n</condensed-context>`.length / 4);
			const editedSaved = (Number(metrics.beforeTokens) || 0) - editedAfter;
			const editedRatio = Number(metrics.beforeTokens) > 0 ? editedSaved / Number(metrics.beforeTokens) : 0;
			Array.from(/* @__PURE__ */ new Set([
				...risks,
				...editedRatio < .4 ? ["savings-below-40-percent"] : [],
				...editedSaved < 500 ? ["savings-below-500-tokens"] : []
			]));
			const canCancel = !saving || generating;
			const submit = () => {
				if (saving || needsGeneration || !value.trim()) return;
				onApply(value);
			};
			const onKeyDown = (event) => {
				if (event.key === "Escape" && canCancel) {
					event.preventDefault();
					onCancel();
					return;
				}
				if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
					event.preventDefault();
					submit();
				}
			};
			return h("div", { className: "context-editor__dialog-backdrop" }, h("div", {
				className: "context-editor__dialog context-editor__condensation-dialog",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": text.condensationTitle,
				onKeyDown
			}, h("div", { className: "context-editor__dialog-header" }, h("h2", null, text.condensationTitle), h("button", {
				type: "button",
				className: "context-editor__dialog-close",
				disabled: !canCancel,
				onClick: onCancel,
				"aria-label": text.cancel
			}, "×")), h("label", { className: "context-editor__replacement-link-option" }, h("input", {
				type: "checkbox",
				checked: expandRelated,
				disabled: saving || proposal?.canExpandRelated !== true,
				onChange: (event) => setExpandRelated(event.target.checked)
			}), h("span", { style: proposal?.canExpandRelated === true ? void 0 : { opacity: .45 } }, text.condensationExpandRelated)), !needsGeneration && proposal?.autoExpandedUnitIds?.length ? h("div", {
				className: "context-editor__condensation-expansion",
				role: "status"
			}, h("div", null, text.condensationExpandedNotice(proposal.autoExpandedUnitIds.length)), h("ul", null, (proposal.sourceUnits ?? []).filter((source) => proposal.autoExpandedUnitIds.includes(source.id)).map((source) => h("li", { key: source.id }, `${text.unitKind(source.kind)}: ${String(source.text ?? "").slice(0, 120)}`)))) : null, !needsGeneration ? h("details", { className: "context-editor__details" }, h("summary", null, text.details), h("div", { className: "context-editor__condensation-meta" }, h("span", null, text.condensationSource(proposal?.effectiveUnitIds?.length ?? 0, proposal?.autoExpandedUnitIds?.length ?? 0)), h("span", null, text.condensationFirstChange(proposal?.sourceRootSeqs?.[0] ?? "—")), h("span", null, text.condensationModel(proposal?.provider, proposal?.model))), h("div", { className: "context-editor__condensation-metrics" }, h("span", null, text.condensationBefore(metrics.beforeTokens)), h("span", null, text.condensationAfter(editedAfter)), h("span", null, text.condensationPrefix(proposal?.prefixTokens)), h("strong", null, text.condensationSaved(editedSaved, editedRatio))), editedRatio < .4 || editedSaved < 500 ? h("div", null, text.condensationLowSaving) : null, warnings.includes("prefix-not-reused") ? h("div", null, text.condensationPrefixNotReused) : null) : null, !needsGeneration ? h("details", { className: "context-editor__condensation-source" }, h("summary", null, text.condensationOriginal), h("div", null, (proposal?.sourceUnits ?? []).filter((source) => source.included).map((source) => h("article", { key: source.id }, h("strong", null, `${source.kind} · ${source.id}`), h("pre", null, source.text))))) : null, !needsGeneration ? h("textarea", {
				ref: textarea,
				className: "context-editor__dialog-input",
				value,
				onChange: (event) => setValue(event.target.value),
				spellCheck: false,
				disabled: saving,
				"aria-label": text.condensationSummary
			}) : null, generating ? h("div", {
				role: "status",
				"aria-live": "polite",
				className: "context-editor__condensation-progress"
			}, text.condensationGenerating) : null, h("div", {
				className: "context-editor__dialog-hint",
				role: "status"
			}, needsGeneration ? text.condensationHint : text.condensationPending), error ? h("div", {
				className: "context-editor__dialog-error",
				role: "alert"
			}, error) : null, h("div", { className: "context-editor__dialog-actions" }, h("button", {
				type: "button",
				disabled: !canCancel,
				onClick: onCancel
			}, text.cancel), h("button", {
				type: "button",
				disabled: saving,
				onClick: () => onRegenerate(expandRelated)
			}, generating ? text.condensationGenerating : needsGeneration ? text.generateCondensation : text.regenerateCondensation), h("button", {
				type: "button",
				disabled: saving || needsGeneration || !value.trim(),
				onClick: submit
			}, saving ? text.loading : text.applyCondensation))));
		}
		function UnitSection({ unit, selected, onSelect, focused, showHidden, showOriginal, match, disabled, onRestore, onContextToggle, onEdit, onRestoreReplacement, onUndoReplacement, onCompareOriginal, replacementAvailable, contextAvailable, contextUnavailableReason, registerNode, text }) {
			const hidden = unit.viewState === "hide" || unit.viewState === "mixed";
			const mixed = unit.viewState === "mixed";
			const projectionState = unit.projectionState ?? "include";
			const contextExcluded = projectionState === "exclude" || projectionState === "mixed";
			const contextUnavailable = projectionState === "unavailable" || Boolean(unit.contextMutationDisabledReason);
			const isEditableKind = unit.kind === "user" || unit.kind === "answer";
			const replacementSupported = unit.replacementSupported === true;
			const replacementTitle = !replacementAvailable ? text.replacementDisabled : text.replacementUnavailable(unit.replacementDisabledReason);
			const body = hidden && !showHidden ? h("div", { className: "context-editor__unit-placeholder" }, mixed ? text.mixedPlaceholder : text.hiddenPlaceholder(unit.kind)) : h(UnitBody, {
				unit,
				match,
				text,
				showOriginal
			});
			return h("div", {
				className: `context-editor__unit ${focused ? "is-focused" : ""} ${hidden ? "is-hidden" : ""} ${contextExcluded ? "is-context-excluded" : ""}`,
				"data-unit-id": unit.id,
				"data-unit-kind": unit.kind,
				"data-context-state": projectionState,
				ref: (node) => registerNode?.(unit.id, node)
			}, h("div", { className: "context-editor__unit-header" }, h("label", { className: "context-editor__unit-select" }, h("input", {
				type: "checkbox",
				checked: selected,
				disabled,
				onChange: (event) => onSelect(event)
			}), h("span", { className: "context-editor__unit-kind" }, text.unitKind(unit.kind))), mixed ? h("span", { className: "context-editor__hidden-badge" }, text.partiallyHidden) : null, hidden && !mixed ? h("span", { className: "context-editor__hidden-badge" }, text.hidden) : null, contextExcluded ? h("span", { className: "context-editor__context-badge" }, text.contextState(projectionState)) : null, hidden ? h("button", {
				type: "button",
				disabled,
				onClick: onRestore
			}, text.restore) : null, isEditableKind && unit.replacementState === "replaced" ? h("span", {
				className: "context-editor__replacement-badge",
				title: text.edited
			}, text.edited) : null, contextUnavailable || isEditableKind && !replacementSupported ? h("details", { className: "context-editor__restriction" }, h("summary", { title: replacementSupported ? text.featureUnavailable(unit.contextMutationDisabledReason) : replacementTitle }, text.actionDetails), h("div", null, [.../* @__PURE__ */ new Set([...contextUnavailable ? [text.featureUnavailable(unit.contextMutationDisabledReason)] : [], ...isEditableKind && !replacementSupported ? [replacementTitle] : []])].join(" "))) : null, isEditableKind && replacementSupported ? h("div", { className: "context-editor__replacement-actions" }, h("button", {
				type: "button",
				disabled: disabled || !replacementAvailable,
				onClick: onEdit,
				title: !replacementAvailable ? text.replacementDisabled : text.editTitle(unit.kind)
			}, text.edit), unit.canRestoreReplacement ? h("button", {
				type: "button",
				disabled: disabled || !replacementAvailable,
				onClick: onRestoreReplacement
			}, text.restoreOriginal) : null, unit.canUndoReplacement ? h("button", {
				type: "button",
				disabled: disabled || !replacementAvailable,
				onClick: onUndoReplacement
			}, text.undoReplacement) : null, unit.replacementState === "replaced" ? h("button", {
				type: "button",
				onClick: onCompareOriginal
			}, showOriginal ? text.showEffective : text.compareOriginal) : null) : null, h("button", {
				type: "button",
				className: "context-editor__context-toggle",
				disabled: disabled || contextUnavailable || !contextAvailable,
				onClick: onContextToggle,
				title: unit.contextMutationDisabledReason ? text.featureUnavailable(unit.contextMutationDisabledReason) : !contextAvailable ? text.featureUnavailable(contextUnavailableReason) : void 0
			}, contextExcluded ? text.restoreContext : text.excludeContext)), h("div", { className: "context-editor__unit-body" }, body));
		}
		function RecordRow({ record, selected, onSelect, focusedUnitId, showHidden, showOriginalUnitId, match, disabled, disabledUnitIds, onRestore, onContextToggle, onEdit, onRestoreReplacement, onUndoReplacement, onCompareOriginal, replacementAvailable, contextAvailable, contextUnavailableReason, registerNode, text }) {
			const units = unitsForRecord(record);
			const focused = units.some((unit) => unit.id === focusedUnitId);
			return h("article", {
				className: `context-editor__row ${focused ? "is-focused" : ""}`,
				"data-record-id": record.id
			}, h("div", { className: "context-editor__row-content" }, h("div", { className: "context-editor__row-meta" }, h("span", { className: "context-editor__kind" }, text.kind(record.kind)), record.toolCallId ? h("code", null, record.toolCallId) : null), h("div", { className: "context-editor__units" }, units.map((unit) => h(UnitSection, {
				key: unit.id,
				unit,
				selected: selected.has(unit.id),
				onSelect: (event) => onSelect(unit, event),
				focused: focusedUnitId === unit.id,
				showHidden,
				showOriginal: showOriginalUnitId === unit.id,
				match: focusedUnitId === unit.id ? match : null,
				disabled: disabled || disabledUnitIds?.has(unit.id),
				onRestore: () => onRestore(unit.id),
				onContextToggle: () => onContextToggle(unit),
				onEdit: () => onEdit(unit),
				onRestoreReplacement: () => onRestoreReplacement(unit),
				onUndoReplacement: () => onUndoReplacement(unit),
				onCompareOriginal: () => onCompareOriginal(unit),
				replacementAvailable,
				contextAvailable,
				contextUnavailableReason,
				registerNode,
				text
			})))));
		}
		/** Context Editor tab body.  The parent ConversationSession keeps the shared composer. */
		function ContextEditorView({ sessionId, controller, useSession, openSession }) {
			const [locale] = (0, react.useState)(() => detectHarnessLocale());
			const text = (0, react.useMemo)(() => createHarnessText(locale), [locale]);
			const running = useSession((snapshot) => Boolean(snapshot?.running));
			const [prefs, setPrefs] = (0, react.useState)(safePreferences);
			const [loaded, setLoaded] = (0, react.useState)({
				status: "loading",
				snapshot: null,
				records: [],
				nextCursor: null,
				total: 0,
				error: null
			});
			const [historyLoading, setHistoryLoading] = (0, react.useState)(false);
			const [query, setQuery] = (0, react.useState)("");
			const [searchScope, setSearchScope] = (0, react.useState)("dialogue");
			const [search, setSearch] = (0, react.useState)(null);
			const [searchIndex, setSearchIndex] = (0, react.useState)(0);
			const [match, setMatch] = (0, react.useState)(null);
			const [selected, setSelected] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [matching, setMatching] = (0, react.useState)(false);
			const [contextMutating, setContextMutating] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(null);
			const [comparisonUnitId, setComparisonUnitId] = (0, react.useState)(null);
			const [condensation, setCondensation] = (0, react.useState)(null);
			const [condensationLoading, setCondensationLoading] = (0, react.useState)(false);
			const [generatingCondensation, setGeneratingCondensation] = (0, react.useState)(false);
			const condensationGeneration = (0, react.useRef)(0);
			const [condensationError, setCondensationError] = (0, react.useState)("");
			const [condensationModels, setCondensationModels] = (0, react.useState)([]);
			const [condensationModel, setCondensationModel] = (0, react.useState)("");
			const [condensationOperationId, setCondensationOperationId] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const [operationRecoveryPending, setOperationRecoveryPending] = (0, react.useState)(() => Boolean(readPendingReplacement(sessionId)));
			const [operationUnverified, setOperationUnverified] = (0, react.useState)(false);
			const [compatibilityCheckLoading, setCompatibilityCheckLoading] = (0, react.useState)(false);
			const [compatibilityCheckError, setCompatibilityCheckError] = (0, react.useState)("");
			const currentSessionIdRef = (0, react.useRef)(String(sessionId));
			currentSessionIdRef.current = String(sessionId);
			const lastSelectedIndex = (0, react.useRef)(null);
			const loadSequence = (0, react.useRef)(0);
			const historyPageGeneration = (0, react.useRef)(0);
			const historyLoadingRef = (0, react.useRef)(false);
			const historyRecordsRef = (0, react.useRef)([]);
			const historyCursorRef = (0, react.useRef)(null);
			const historyRevisionRef = (0, react.useRef)(null);
			const searchSequence = (0, react.useRef)(0);
			const matchSequence = (0, react.useRef)(0);
			const navigationIndexRef = (0, react.useRef)(0);
			const requestedIndexRef = (0, react.useRef)(0);
			const scrollSequence = (0, react.useRef)(0);
			const unitNodes = (0, react.useRef)(/* @__PURE__ */ new Map());
			const searchInput = (0, react.useRef)(null);
			const controlsNode = (0, react.useRef)(null);
			const editFocus = (0, react.useRef)(null);
			const replacementOperationIds = (0, react.useRef)(/* @__PURE__ */ new Map());
			const activeCondensationRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => {
				++condensationGeneration.current;
				const active = activeCondensationRef.current;
				if (active?.controller === controller) {
					activeCondensationRef.current = null;
					controller.cancelCondensation(active.operationId).catch(() => {});
				}
			}, [controller, sessionId]);
			(0, react.useEffect)(() => {
				setSearchScope("dialogue");
				setSearch(null);
				setMatch(null);
				setSearchIndex(0);
				setEditing(null);
				setComparisonUnitId(null);
				setCondensation(null);
				setCondensationLoading(false);
				setGeneratingCondensation(false);
				setCondensationError("");
				setCondensationModels([]);
				setCondensationModel("");
				setCondensationOperationId("");
				setNotice("");
				historyPageGeneration.current += 1;
				historyLoadingRef.current = false;
				historyRecordsRef.current = [];
				historyCursorRef.current = null;
				historyRevisionRef.current = null;
				setHistoryLoading(false);
				replacementOperationIds.current.clear();
				setOperationRecoveryPending(Boolean(readPendingReplacement(sessionId)));
				setOperationUnverified(false);
				setCompatibilityCheckError("");
			}, [sessionId]);
			const registerUnitNode = (0, react.useCallback)((unitId, node) => {
				if (node) unitNodes.current.set(unitId, node);
				else unitNodes.current.delete(unitId);
			}, []);
			const enabledRecordKinds = (0, react.useMemo)(() => enabledRecordKindsForUnits(prefs.enabledUnitKinds), [prefs.enabledUnitKinds]);
			const visibleRecords = (0, react.useMemo)(() => {
				const records = [];
				const summaries = loaded.snapshot?.condensations ?? [];
				const covered = new Set(summaries.flatMap((item) => item.effectiveUnitIds ?? []));
				const inserted = /* @__PURE__ */ new Set();
				for (const record of loaded.records) {
					const units = unitsForRecord(record);
					for (const item of summaries) if (!inserted.has(item.operationId) && units.some((unit) => item.effectiveUnitIds?.includes(unit.id))) {
						records.push({
							id: "condensation-" + item.operationId,
							condensation: item,
							units: []
						});
						inserted.add(item.operationId);
					}
					if (!enabledRecordKinds.includes(record.kind)) continue;
					const remaining = units.filter((unit) => !covered.has(unit.id) && (record.kind !== "ai" || prefs.enabledUnitKinds.includes(unit.kind)));
					if (remaining.length) records.push(remaining.length === units.length ? record : {
						...record,
						units: remaining
					});
				}
				for (const item of summaries) if (!inserted.has(item.operationId)) records.push({
					id: "condensation-" + item.operationId,
					condensation: item,
					units: []
				});
				return records;
			}, [
				enabledRecordKinds,
				loaded.records,
				loaded.snapshot?.condensations,
				prefs.enabledUnitKinds
			]);
			const visibleUnits = (0, react.useMemo)(() => visibleRecords.filter((record) => !record.condensation).flatMap((record) => unitsForRecord(record)), [visibleRecords]);
			const selectedCount = selected.size;
			const readOnly = running || loaded.status === "loading" || loaded.status === "refreshing" || contextMutating || condensationLoading || operationRecoveryPending || operationUnverified;
			const contextAvailable = loaded.snapshot?.capabilities?.contextExclusion === true;
			const replacementAvailable = loaded.snapshot?.capabilities?.contextReplacement === true;
			const condensationAvailable = loaded.snapshot?.capabilities?.contextCondensation === true;
			const contextUnavailableReason = loaded.snapshot?.contextMutationUnavailableReason;
			const condensedUnitIds = (0, react.useMemo)(() => new Set((loaded.snapshot?.condensations ?? []).flatMap((item) => item.effectiveUnitIds ?? [])), [loaded.snapshot?.condensations]);
			const refresh = (0, react.useCallback)(async (preserveSelection = false) => {
				const ticket = ++loadSequence.current;
				historyPageGeneration.current += 1;
				historyLoadingRef.current = false;
				setHistoryLoading(false);
				setLoaded((current) => ({
					...current,
					status: current.snapshot ? "refreshing" : "loading",
					error: null
				}));
				try {
					const value = await controller.load();
					if (value === null || ticket !== loadSequence.current) return;
					historyRecordsRef.current = value.records;
					historyCursorRef.current = value.nextCursor ?? null;
					historyRevisionRef.current = value.snapshot.revision;
					setLoaded({
						status: "ready",
						...value,
						error: null
					});
					if (!preserveSelection) {
						setSelected(/* @__PURE__ */ new Set());
						lastSelectedIndex.current = null;
					}
				} catch (error) {
					if (ticket === loadSequence.current) setLoaded((current) => ({
						...current,
						status: "error",
						error
					}));
				}
			}, [controller]);
			const loadHistory = (0, react.useCallback)(async (targetRecordId) => {
				const currentRecords = historyRecordsRef.current;
				if (targetRecordId && currentRecords.some((record) => record.id === targetRecordId)) return true;
				if (historyLoadingRef.current || historyCursorRef.current === null || historyRevisionRef.current === null) return false;
				const generation = historyPageGeneration.current;
				const expectedRevision = historyRevisionRef.current;
				historyLoadingRef.current = true;
				setHistoryLoading(true);
				try {
					let page;
					if (targetRecordId) {
						const direct = await controller.loadRecord(targetRecordId, expectedRevision);
						if (direct === null) page = await controller.loadUntilRecord(targetRecordId, historyCursorRef.current, expectedRevision, currentRecords);
						else if (!direct.found || direct.record === null) return false;
						else page = {
							records: [direct.record],
							nextCursor: historyCursorRef.current,
							total: direct.total,
							found: true
						};
					} else page = await controller.loadRecordsPage(historyCursorRef.current, expectedRevision);
					if (generation !== historyPageGeneration.current || currentSessionIdRef.current !== String(sessionId)) return false;
					const records = [...currentRecords, ...page.records ?? []];
					const orderedRecords = [...new Map(records.map((record) => [record.id, record])).values()].sort((left, right) => Number(left.historyIndex ?? Number.MAX_SAFE_INTEGER) - Number(right.historyIndex ?? Number.MAX_SAFE_INTEGER));
					const uniqueRecords = orderedRecords.map((record, index) => {
						const currentIndex = Number(record.historyIndex);
						const previousIndex = index === 0 ? -1 : Number(orderedRecords[index - 1].historyIndex);
						const historyGapBefore = Number.isSafeInteger(currentIndex) && Number.isSafeInteger(previousIndex) ? Math.max(0, currentIndex - previousIndex - 1) : 0;
						return historyGapBefore > 0 ? {
							...record,
							historyGapBefore
						} : record;
					});
					historyRecordsRef.current = uniqueRecords;
					const nextCursor = targetRecordId ? historyCursorRef.current : page.nextCursor ?? null;
					if (!targetRecordId) historyCursorRef.current = nextCursor;
					setLoaded((current) => {
						if (current.snapshot?.sessionId !== String(sessionId) || current.snapshot?.revision !== expectedRevision) return current;
						return {
							...current,
							records: uniqueRecords,
							nextCursor,
							total: page.total ?? current.total ?? uniqueRecords.length
						};
					});
					return targetRecordId ? page.found : true;
				} finally {
					if (generation === historyPageGeneration.current) {
						historyLoadingRef.current = false;
						setHistoryLoading(false);
					}
				}
			}, [controller, sessionId]);
			const recheckCompatibility = (0, react.useCallback)(async () => {
				setCompatibilityCheckLoading(true);
				setCompatibilityCheckError("");
				try {
					await controller.runCompatibilityCheck();
					await refresh(true);
				} catch (error) {
					setCompatibilityCheckError(text.compatibilityCheckFailed(errorText(error)));
				} finally {
					setCompatibilityCheckLoading(false);
				}
			}, [
				controller,
				refresh,
				text
			]);
			(0, react.useEffect)(() => {
				refresh();
			}, [controller, refresh]);
			(0, react.useEffect)(() => controller.subscribe?.(() => {
				refresh(true);
			}), [controller, refresh]);
			(0, react.useEffect)(() => {
				if (!running) refresh();
			}, [running, refresh]);
			(0, react.useEffect)(() => {
				if (!condensationAvailable) return void 0;
				let cancelled = false;
				controller.listCondensationModels().then((value) => {
					if (cancelled) return;
					const models = Array.isArray(value?.models) ? value.models : [];
					setCondensationModels(models);
					setCondensationModel((current) => current || condensationModelKey(models[0]));
				}).catch(() => {
					if (!cancelled) setCondensationModels([]);
				});
				return () => {
					cancelled = true;
				};
			}, [
				controller,
				condensationAvailable,
				sessionId
			]);
			(0, react.useEffect)(() => {
				const visibleIds = new Set(visibleUnits.map((unit) => unit.id));
				setSelected((current) => {
					const next = new Set([...current].filter((id) => visibleIds.has(id)));
					if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
					return next;
				});
				lastSelectedIndex.current = null;
			}, [visibleUnits]);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key !== "/" || event.defaultPrevented) return;
					const target = event.target;
					if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
					event.preventDefault();
					searchInput.current?.focus?.();
				};
				globalThis.addEventListener?.("keydown", onKeyDown);
				return () => globalThis.removeEventListener?.("keydown", onKeyDown);
			}, []);
			(0, react.useEffect)(() => {
				const ticket = ++searchSequence.current;
				const matchTicket = ++matchSequence.current;
				const needle = query.trim();
				setSearch(null);
				setMatch(null);
				setSearchIndex(0);
				setMatching(false);
				navigationIndexRef.current = 0;
				requestedIndexRef.current = 0;
				setSelected(/* @__PURE__ */ new Set());
				lastSelectedIndex.current = null;
				if (!needle) return;
				const timer = setTimeout(() => {
					(async () => {
						if (ticket !== searchSequence.current) return;
						setMatching(true);
						try {
							const value = await controller.search(needle, enabledRecordKinds, searchScope, prefs.enabledUnitKinds);
							if (ticket !== searchSequence.current) return;
							setSearch(value);
							if (value.total < 1) {
								setSearchIndex(0);
								setMatching(false);
								return;
							}
							const first = await controller.match(value.searchId, 0, value.revision);
							if (first?.recordId && !await loadHistory(first.recordId)) throw new Error("CONTEXT_EDITOR_SEARCH_RESULT_NOT_IN_HISTORY");
							if (ticket === searchSequence.current && matchTicket === matchSequence.current) {
								navigationIndexRef.current = 0;
								requestedIndexRef.current = 0;
								setSearchIndex(0);
								setMatch(first);
								setMatching(false);
							}
						} catch (error) {
							if (ticket === searchSequence.current) {
								setSearch({ error });
								setMatch(null);
								setMatching(false);
							}
						}
					})();
				}, 120);
				return () => clearTimeout(timer);
			}, [
				controller,
				enabledRecordKinds,
				loadHistory,
				prefs.enabledUnitKinds,
				query,
				searchScope
			]);
			(0, react.useEffect)(() => {
				const ticket = ++scrollSequence.current;
				const unitId = match?.unitId;
				if (!unitId) return void 0;
				let frame;
				let initialTimer;
				let correctionTimer;
				let correctionFrame;
				const scroll = (behavior) => {
					if (ticket !== scrollSequence.current) return;
					const node = unitNodes.current.get(unitId);
					if (!node) return;
					const target = node.querySelector("mark.context-editor__hit") ?? node;
					const container = findScrollableContainer(node);
					if (!container) return;
					const containerRect = elementRect(container, globalThis.innerHeight ?? 0);
					const targetRect = elementRect(target);
					const controlsRect = elementRect(controlsNode.current);
					const currentScrollTop = scrollTopOf(container);
					const nextScrollTop = computeCenteredScrollTop({
						currentScrollTop,
						scrollHeight: container.scrollHeight,
						clientHeight: container.clientHeight,
						containerTop: containerRect.top,
						containerBottom: containerRect.bottom,
						controlsBottom: controlsRect.bottom,
						targetTop: targetRect.top,
						targetBottom: targetRect.bottom
					});
					if (Math.abs(nextScrollTop - currentScrollTop) > 1) scrollToTop(container, nextScrollTop, behavior);
				};
				const settle = () => {
					if (ticket !== scrollSequence.current) return;
					if (typeof globalThis.requestAnimationFrame === "function") correctionFrame = globalThis.requestAnimationFrame(() => scroll("auto"));
					else scroll("auto");
				};
				const schedule = () => {
					if (ticket !== scrollSequence.current) return;
					scroll("smooth");
					correctionTimer = globalThis.setTimeout(settle, 350);
				};
				if (typeof globalThis.requestAnimationFrame === "function") frame = globalThis.requestAnimationFrame(schedule);
				else initialTimer = globalThis.setTimeout(schedule, 0);
				return () => {
					if (frame !== void 0) globalThis.cancelAnimationFrame?.(frame);
					if (initialTimer !== void 0) globalThis.clearTimeout?.(initialTimer);
					if (correctionTimer !== void 0) globalThis.clearTimeout?.(correctionTimer);
					if (correctionFrame !== void 0) globalThis.cancelAnimationFrame?.(correctionFrame);
				};
			}, [
				loaded.records,
				match?.atomId,
				match?.end,
				match?.field,
				match?.start,
				match?.unitId,
				prefs.enabledUnitKinds,
				search?.searchId,
				searchIndex
			]);
			const updatePrefs = (0, react.useCallback)((next) => {
				setPrefs((current) => {
					const value = {
						...current,
						...next
					};
					savePreferences(value);
					return value;
				});
			}, []);
			const toggleUnitKind = (kind) => {
				updatePrefs({ enabledUnitKinds: toggleEnabledUnitKind(prefs.enabledUnitKinds, kind) });
			};
			const toggleAiKind = () => {
				const next = prefs.enabledUnitKinds.includes("reasoning") && prefs.enabledUnitKinds.includes("answer") ? prefs.enabledUnitKinds.filter((kind) => kind !== "reasoning" && kind !== "answer") : [.../* @__PURE__ */ new Set([
					...prefs.enabledUnitKinds,
					"reasoning",
					"answer"
				])];
				updatePrefs({ enabledUnitKinds: next });
			};
			const toggleSearchScope = () => {
				setSearchScope((current) => current === "dialogue" ? "all" : "dialogue");
				setSearchIndex(0);
				setMatch(null);
				setSelected(/* @__PURE__ */ new Set());
				lastSelectedIndex.current = null;
			};
			const selectUnit = (unit, event) => {
				const index = visibleUnits.findIndex((value) => value.id === unit.id);
				setSelected((current) => {
					const next = new Set(current);
					if (event.shiftKey && lastSelectedIndex.current !== null) {
						const start = Math.min(lastSelectedIndex.current, index);
						const end = Math.max(lastSelectedIndex.current, index);
						for (const value of visibleUnits.slice(start, end + 1)) next.add(value.id);
					} else if (next.has(unit.id)) next.delete(unit.id);
					else next.add(unit.id);
					return next;
				});
				lastSelectedIndex.current = index;
			};
			const mutate = async (action, unitIds) => {
				if (readOnly || loaded.snapshot === null) return;
				try {
					if ((await controller.commit(action, loaded.snapshot.revision, unitIds))?.conflict) {
						await refresh(true);
						return;
					}
					await refresh(true);
				} catch (error) {
					setLoaded((current) => ({
						...current,
						status: "error",
						error
					}));
				}
			};
			const mutateContext = async (action, unitIds, options = {}) => {
				if (readOnly || !contextAvailable || loaded.snapshot === null) return;
				setContextMutating(true);
				let operationId;
				try {
					const preview = await controller.previewContext(action, loaded.snapshot.contextRevision ?? loaded.snapshot.revision, unitIds, options);
					if (preview?.canCommit === false) {
						setNotice(text.featureUnavailable(preview.disabledReason));
						return;
					}
					if (preview?.conflict) {
						await refresh(true);
						return;
					}
					const estimate = preview?.tokenEstimate ?? {};
					const closureCount = Math.max(0, (preview?.effectiveTargets?.length ?? 0) - (preview?.normalizedTargets?.length ?? 0));
					const warning = text.contextPreview(estimate.before, estimate.after, estimate.delta, closureCount) + (closureCount ? "\n\n" + (preview.effectiveSelection ?? []).map((unit) => `${text.unitKind(unit.kind)}: ${unit.preview}`).join("\n") : "");
					let confirmed = true;
					if (typeof globalThis.confirm === "function") try {
						confirmed = globalThis.confirm(warning);
					} catch {
						confirmed = true;
					}
					if (!confirmed) return;
					operationId = preview.operationId;
					rememberPendingReplacement(action, unitIds.join(","), preview.operationId);
					const value = await controller.commitContext(preview.operationId, action, preview.expectedRevision ?? loaded.snapshot.revision, unitIds, {
						...options,
						selectionFingerprint: preview.selectionFingerprint
					});
					if (value?.conflict) {
						clearTrackedReplacement(preview.operationId);
						await refresh(true);
						return;
					}
					if (value?.commit?.status === "unverified" || value?.ok === false) {
						setOperationUnverified(true);
						setNotice(text.operationUnverified);
						return;
					}
					clearTrackedReplacement(preview.operationId);
					await refresh(true);
				} catch (error) {
					if (operationId) {
						const status = await resolvePendingReplacement(operationId);
						if ([
							"persisted-and-verified",
							"pending",
							"unverified",
							"stale"
						].includes(status)) return;
					}
					setLoaded((current) => ({
						...current,
						status: "error",
						error
					}));
				} finally {
					setContextMutating(false);
				}
			};
			const openCondensation = () => {
				const unit = selectedCount === 1 ? visibleUnits.find((item) => selected.has(item.id)) : void 0;
				setCondensationError("");
				setCondensation({
					draft: true,
					operationId: "draft-" + Date.now(),
					canExpandRelated: unit?.kind === "answer",
					expandRelated: false,
					summary: ""
				});
			};
			const startCondensation = async (expandRelated = false) => {
				if (readOnly || !condensationAvailable || selectedCount === 0 || loaded.snapshot === null) return;
				const generation = ++condensationGeneration.current;
				setGeneratingCondensation(true);
				setCondensationLoading(true);
				setCondensationError("");
				const operationId = `condensation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
				setCondensationOperationId(operationId);
				activeCondensationRef.current = {
					controller,
					operationId
				};
				try {
					const selectedModel = condensationModels.find((value) => condensationModelKey(value) === condensationModel);
					const proposal = await controller.generateCondensation([...selected], loaded.snapshot.contextRevision ?? loaded.snapshot.revision, {
						operationId,
						expandRelated,
						...selectedModel?.provider ? { provider: selectedModel.provider } : {},
						...selectedModel?.id ? { model: selectedModel.id } : {}
					});
					if (generation !== condensationGeneration.current) return;
					if (proposal?.conflict) {
						setCondensationError(text.condensationConflict);
						setCondensationOperationId("");
						await refresh(true);
						return;
					}
					setCondensation(proposal);
					setCondensationOperationId(String(proposal?.operationId ?? operationId));
				} catch (error) {
					if (generation !== condensationGeneration.current) return;
					setCondensationOperationId("");
					if (!String(error?.message ?? error).includes("CANCELLED")) setCondensationError(text.condensationFailed(errorText(error)));
				} finally {
					if (generation === condensationGeneration.current) {
						setGeneratingCondensation(false);
						setCondensationLoading(false);
					}
				}
			};
			const cancelCondensation = async () => {
				if (!condensationOperationId) return;
				try {
					await controller.cancelCondensation(condensationOperationId);
					++condensationGeneration.current;
					setGeneratingCondensation(false);
					setCondensationLoading(false);
					setCondensationOperationId("");
					setCondensation(null);
				} catch (error) {
					setCondensationError(text.condensationFailed(errorText(error)));
				}
			};
			const applyCondensation = async (summary) => {
				if (!condensation || loaded.snapshot === null) return;
				setCondensationLoading(true);
				setCondensationError("");
				try {
					const result = await controller.commitCondensation(condensation, summary);
					if (currentSessionIdRef.current !== String(sessionId)) return;
					if (result?.conflict) {
						setCondensationError(text.condensationConflict);
						await refresh(true);
						return;
					}
					if (result?.ok !== true) throw new Error("CONTEXT_EDITOR_CONDENSATION_COMMIT_FAILED");
					setCondensation(null);
					activeCondensationRef.current = null;
					setCondensationOperationId("");
					setSelected(/* @__PURE__ */ new Set());
					await refresh(true);
				} catch (error) {
					setCondensationError(text.condensationFailed(errorText(error)));
				} finally {
					setCondensationLoading(false);
				}
			};
			const discardCondensation = async () => {
				const operationId = condensationOperationId || condensation?.operationId;
				if (operationId) try {
					await controller.cancelCondensation(operationId);
				} catch {}
				setCondensation(null);
				setCondensationOperationId("");
				setCondensationError("");
			};
			const regenerateCondensation = async (expandRelated = false) => {
				const old = condensationOperationId;
				if (old) try {
					await controller.cancelCondensation(old);
				} catch {}
				setCondensation((current) => ({
					...current,
					draft: true,
					expandRelated
				}));
				await startCondensation(expandRelated);
			};
			const createRecovery = async (option) => {
				if (readOnly || loaded.snapshot === null) return;
				const sourceSessionId = String(sessionId);
				setContextMutating(true);
				setNotice("");
				try {
					const request = {
						kind: option.kind,
						...option.kind === "native-compaction" ? { compactionId: option.compactionId } : { operationId: option.operationId }
					};
					const preview = await controller.previewRecovery(request);
					if (preview?.ok !== true) throw new Error(preview?.reason ?? "recovery-preview-unavailable");
					let confirmed = true;
					if (typeof globalThis.confirm === "function") try {
						confirmed = globalThis.confirm(text.recoveryPreview(preview.messageCount, preview.retainedMessageCount) + "\n\n" + (preview.conversationPreview ?? ""));
					} catch {
						confirmed = false;
					}
					if (!confirmed) return;
					const result = await controller.createRecoveryBranch({
						...request,
						previewFingerprint: preview.prefixFingerprint
					});
					if (currentSessionIdRef.current !== sourceSessionId) return;
					if (result?.conflict) {
						setNotice(text.recoveryUnavailable(result.reason ?? "recovery-prefix-changed"));
						await refresh(true);
						return;
					}
					if (result?.ok !== true || result?.commit?.status !== "persisted-and-verified" || !result.targetSessionId) throw new Error(result?.commit?.status ?? "recovery-result-unverified");
					setNotice("");
					await refresh(true);
					if (currentSessionIdRef.current === sourceSessionId && typeof openSession === "function") openSession(result.targetSessionId);
				} catch (error) {
					setNotice(text.recoveryUnavailable(errorText(error)));
				} finally {
					setContextMutating(false);
				}
			};
			const toggleCondensationContext = async (item) => {
				if (readOnly || loaded.snapshot === null) return;
				const summaryUnitId = (item.sourceUnits ?? []).find((source) => source.included !== false)?.id;
				if (!summaryUnitId) return;
				const action = item.contextExcluded === true ? "restore" : "exclude";
				await mutateContext(action, [summaryUnitId], { condensationOperationId: item.operationId });
			};
			const closeReplacementDialog = () => {
				const target = editFocus.current;
				editFocus.current = null;
				setEditing(null);
				globalThis.setTimeout?.(() => target?.focus?.(), 0);
			};
			const openReplacementEdit = (unit) => {
				if (readOnly || !replacementAvailable || unit.replacementSupported !== true) return;
				editFocus.current = globalThis.document?.activeElement ?? null;
				setNotice("");
				setComparisonUnitId(null);
				setEditing({
					id: unit.id,
					unitId: unit.id,
					kind: unit.kind,
					operations: unit.operations,
					associatedReasoningUnitIds: unit.associatedReasoningUnitIds ?? [],
					text: String(unit.effectiveText ?? unit.atoms?.map((atom) => atom.text ?? "").join("\n") ?? "")
				});
			};
			const replacementOperationId = (action, unitId, payload = "") => {
				const key = `${action}:${unitId}`;
				const current = replacementOperationIds.current.get(key);
				const fingerprint = String(payload);
				if (current?.fingerprint === fingerprint) return current.id;
				const id = controller.replacementOperationId(action, unitId);
				replacementOperationIds.current.set(key, {
					id,
					fingerprint
				});
				return id;
			};
			const rememberPendingReplacement = (action, unitId, operationId) => {
				writePendingReplacement(sessionId, {
					action,
					unitId,
					operationId
				});
				setOperationRecoveryPending(true);
				setOperationUnverified(false);
			};
			const clearTrackedReplacement = (operationId) => {
				clearPendingReplacement(sessionId, operationId);
				setOperationRecoveryPending(false);
				setOperationUnverified(false);
			};
			const resolvePendingReplacement = (0, react.useCallback)(async (operationId) => {
				let operation;
				try {
					operation = await controller.getOperation(operationId);
				} catch {
					if (currentSessionIdRef.current !== String(sessionId)) return "stale";
					setOperationRecoveryPending(false);
					setOperationUnverified(true);
					setNotice(text.operationUnverified);
					return "unverified";
				}
				if (currentSessionIdRef.current !== String(sessionId)) return "stale";
				if (!operation) {
					clearPendingReplacement(sessionId, operationId);
					setOperationRecoveryPending(false);
					setOperationUnverified(false);
					return "missing";
				}
				const status = operation.status ?? operation.commit?.status;
				if (status === "persisted-and-verified") {
					clearPendingReplacement(sessionId, operationId);
					replacementOperationIds.current.delete(`${operation.action}:${operation.unitId}`);
					setOperationRecoveryPending(false);
					setOperationUnverified(false);
					setNotice("");
					await refresh(true);
					return status;
				}
				if (status === "pending") {
					if (operation.unitId && [
						"replace",
						"restore",
						"undo"
					].includes(operation.action)) replacementOperationIds.current.set(`${operation.action}:${operation.unitId}`, {
						id: String(operation.operationId ?? operationId),
						fingerprint: operation.action === "replace" ? String(operation.afterText ?? "") : ""
					});
					setOperationRecoveryPending(false);
					setOperationUnverified(false);
					setNotice(text.operationPending);
					return status;
				}
				if (status === "failed") {
					clearPendingReplacement(sessionId, operationId);
					setOperationRecoveryPending(false);
					setOperationUnverified(false);
					setNotice(text.operationFailed);
					return status;
				}
				setOperationRecoveryPending(false);
				setOperationUnverified(true);
				setNotice(text.operationUnverified);
				return "unverified";
			}, [
				controller,
				refresh,
				sessionId,
				text
			]);
			(0, react.useEffect)(() => {
				const pending = readPendingReplacement(sessionId);
				setOperationRecoveryPending(Boolean(pending));
				setOperationUnverified(false);
				if (!pending) return void 0;
				resolvePendingReplacement(pending.operationId);
			}, [resolvePendingReplacement, sessionId]);
			const saveReplacement = async (value, options = {}) => {
				if (!editing || loaded.snapshot === null) return;
				if (running) throw new Error("CONTEXT_EDITOR_BUSY");
				setContextMutating(true);
				let operationId;
				try {
					const contextRevision = loaded.snapshot.contextRevision ?? loaded.snapshot.revision;
					const preview = await controller.previewReplacement(editing.unitId, contextRevision, value, options.excludeAssociatedReasoning === true);
					if (preview?.conflict) {
						replacementOperationIds.current.delete(`replace:${editing.unitId}`);
						setNotice(text.replacementConflict);
						closeReplacementDialog();
						await refresh(true);
						return;
					}
					if (preview?.canCommit === false) {
						const failure = new Error(preview.disabledReason ?? "CONTEXT_EDITOR_REPLACEMENT_LINK_UNAVAILABLE");
						failure.preview = preview;
						throw failure;
					}
					if (preview?.requiresConfirmation && !options.confirmedUnitIds?.length) {
						const failure = /* @__PURE__ */ new Error("CONTEXT_EDITOR_REPLACEMENT_CONFIRMATION_REQUIRED");
						failure.preview = preview;
						throw failure;
					}
					operationId = replacementOperationId("replace", editing.unitId, value);
					rememberPendingReplacement("replace", editing.unitId, operationId);
					const result = await controller.commitReplacement(editing.unitId, contextRevision, value, {
						operationId,
						excludeAssociatedReasoning: options.excludeAssociatedReasoning === true,
						confirmedUnitIds: options.confirmedUnitIds
					});
					if (result?.conflict) {
						replacementOperationIds.current.delete(`replace:${editing.unitId}`);
						clearTrackedReplacement(operationId);
						setNotice(text.replacementConflict);
						closeReplacementDialog();
						await refresh(true);
						return;
					}
					if (result?.ok !== true || result?.commit?.status !== "persisted-and-verified") {
						setOperationRecoveryPending(false);
						if (result?.commit?.status === "pending") setNotice(text.operationPending);
						else {
							setOperationUnverified(true);
							setNotice(text.operationUnverified);
							closeReplacementDialog();
						}
						return;
					}
					closeReplacementDialog();
					replacementOperationIds.current.delete(`replace:${editing.unitId}`);
					clearTrackedReplacement(operationId);
					setNotice("");
					await refresh(true);
				} catch (error) {
					if (operationId) {
						const status = await resolvePendingReplacement(operationId);
						if (status === "persisted-and-verified") {
							closeReplacementDialog();
							return;
						}
						if (status === "pending" || status === "unverified" || status === "stale") {
							if (status === "unverified") closeReplacementDialog();
							return;
						}
					}
					if (!error?.preview) setNotice(text.editFailed(errorText(error)));
					throw error;
				} finally {
					setContextMutating(false);
				}
			};
			const mutateReplacement = async (action, unit) => {
				if (readOnly || !replacementAvailable || unit.replacementSupported !== true || loaded.snapshot === null) return;
				if (action === "restore" && typeof globalThis.confirm === "function") {
					let confirmed = true;
					try {
						confirmed = globalThis.confirm(text.restoreReplacementConfirm);
					} catch {
						confirmed = true;
					}
					if (!confirmed) return;
				}
				setContextMutating(true);
				let operationId;
				try {
					const method = action === "restore" ? "restoreReplacement" : "undoReplacement";
					operationId = replacementOperationId(action, unit.id);
					rememberPendingReplacement(action, unit.id, operationId);
					const result = await controller[method](unit.id, loaded.snapshot.contextRevision ?? loaded.snapshot.revision, { operationId });
					if (result?.conflict) {
						replacementOperationIds.current.delete(`${action}:${unit.id}`);
						clearTrackedReplacement(operationId);
						setNotice(text.replacementConflict);
						await refresh(true);
						return;
					}
					if (result?.ok !== true || result?.commit?.status !== "persisted-and-verified") {
						setOperationRecoveryPending(false);
						if (result?.commit?.status === "pending") setNotice(text.operationPending);
						else {
							setOperationUnverified(true);
							setNotice(text.operationUnverified);
						}
						return;
					}
					replacementOperationIds.current.delete(`${action}:${unit.id}`);
					clearTrackedReplacement(operationId);
					setNotice("");
					await refresh(true);
				} catch (error) {
					if (operationId) {
						const status = await resolvePendingReplacement(operationId);
						if (status === "persisted-and-verified" || status === "pending" || status === "unverified" || status === "stale") return;
					}
					setNotice(text.editFailed(errorText(error)));
				} finally {
					setContextMutating(false);
				}
			};
			const compareOriginal = (unit) => {
				if (unit.replacementState !== "replaced") return;
				setComparisonUnitId((current) => current === unit.id ? null : unit.id);
			};
			const undo = async () => {
				if (readOnly || loaded.snapshot === null || !loaded.snapshot.canUndo) return;
				try {
					if ((await controller.undo(loaded.snapshot.revision))?.conflict) await refresh(true);
					else await refresh(true);
				} catch (error) {
					setLoaded((current) => ({
						...current,
						status: "error",
						error
					}));
				}
			};
			const moveMatch = async (delta) => {
				if (!search || search.error || search.total < 1) return;
				const nextIndex = nextSearchIndex(requestedIndexRef.current, delta, search.total);
				requestedIndexRef.current = nextIndex;
				const ticket = ++matchSequence.current;
				setMatching(true);
				try {
					const value = await controller.match(search.searchId, nextIndex, search.revision);
					if (value?.recordId && !await loadHistory(value.recordId)) throw new Error("CONTEXT_EDITOR_SEARCH_RESULT_NOT_IN_HISTORY");
					if (ticket === matchSequence.current) {
						navigationIndexRef.current = nextIndex;
						setSearchIndex(nextIndex);
						setMatch(value);
						setMatching(false);
					}
				} catch {
					if (ticket === matchSequence.current) {
						requestedIndexRef.current = navigationIndexRef.current;
						setMatching(false);
						setMatch(null);
					}
				}
			};
			const loadMoreHistory = () => {
				loadHistory().catch((error) => {
					setLoaded((current) => ({
						...current,
						status: "error",
						error
					}));
				});
			};
			const matchUnitId = match?.unitId;
			const aiState = aiFilterState(prefs.enabledUnitKinds);
			const renderCondensation = (item) => {
				const coverage = item.coverage ?? {
					status: "none",
					restoreMode: "inline",
					coveredSourceRootSeqs: [],
					uncoveredSourceRootSeqs: []
				};
				const coveredCount = coverage.coveredSourceRootSeqs?.length ?? 0;
				const totalCount = (coverage.coveredSourceRootSeqs?.length ?? 0) + (coverage.uncoveredSourceRootSeqs?.length ?? 0);
				const restoreBlocked = item.recovery?.available !== true;
				return h("article", {
					key: item.operationId,
					className: "context-editor__condensation-card",
					"data-condensation-operation-id": item.operationId
				}, h("div", { className: "context-editor__condensation-card-header" }, h("strong", null, text.activeCondensation), h("button", {
					type: "button",
					disabled: readOnly || !contextAvailable,
					title: !contextAvailable ? text.featureUnavailable(contextUnavailableReason) : void 0,
					onClick: () => void toggleCondensationContext(item)
				}, item.contextExcluded === true ? text.restoreContext : text.excludeContext), h("button", {
					type: "button",
					disabled: readOnly || !item.recovery?.available,
					title: restoreBlocked ? text.recoveryUnavailable(item.recovery?.reason ?? "recovery-boundary-unavailable") : void 0,
					onClick: () => void createRecovery({
						kind: "condensation",
						operationId: item.operationId
					})
				}, text.restoreCondensation)), h("pre", { className: "context-editor__condensation-summary" }, item.summary), h("details", { className: "context-editor__details" }, h("summary", null, text.details), h("span", null, text.condensationModel(item.provider, item.model)), h("div", {
					className: "context-editor__condensation-risks",
					role: "status"
				}, text.condensationCoverage(coverage.status, coveredCount, totalCount)), coverage.restoreMode === "checkpoint" ? h("div", { className: "context-editor__condensation-risks" }, text.condensationCheckpoint(coverage.checkpointSeq)) : null, coverage.restoreMode === "unavailable" ? h("div", { className: "context-editor__condensation-risks" }, text.condensationRestoreUnavailable) : null, h("div", { className: "context-editor__condensation-card-metrics" }, h("span", null, text.condensationBefore(item.metrics?.beforeTokens)), " → ", h("span", null, text.condensationAfter(item.metrics?.afterTokens)), h("strong", null, " · " + text.condensationSaved(item.metrics?.savedTokens, item.metrics?.savingsRatio))), item.metrics?.belowRecommendedThreshold ? h("div", { className: "context-editor__condensation-risks" }, text.condensationLowSaving) : null), h("details", { className: "context-editor__condensation-source" }, h("summary", null, text.condensationOriginal), h("div", null, (item.sourceUnits ?? []).filter((source) => source.included).map((source) => h("article", { key: source.id }, h("strong", null, `${source.kind} · ${source.id}`), h("pre", null, source.text))))));
			};
			return h("section", {
				className: "context-editor",
				"aria-label": "Context Editor",
				"data-conversation-composer-overlay": ""
			}, h("div", {
				className: "context-editor__controls",
				ref: controlsNode
			}, h("div", { className: "context-editor__toolbar" }, h("div", { className: "context-editor__filters" }, h(FilterButton, {
				kind: "user",
				state: unitFilterState(prefs.enabledUnitKinds, "user"),
				onClick: () => toggleUnitKind("user"),
				text
			}), h("div", { className: "context-editor__filter-group context-editor__filter-group--ai" }, h(FilterButton, {
				kind: "ai",
				state: aiState,
				onClick: toggleAiKind,
				text
			}), h("div", {
				className: "context-editor__subfilters",
				"aria-label": text.kind("ai")
			}, h(FilterButton, {
				kind: "reasoning",
				state: unitFilterState(prefs.enabledUnitKinds, "reasoning"),
				onClick: () => toggleUnitKind("reasoning"),
				text,
				label: text.unitKind("reasoning")
			}), h(FilterButton, {
				kind: "answer",
				state: unitFilterState(prefs.enabledUnitKinds, "answer"),
				onClick: () => toggleUnitKind("answer"),
				text,
				label: text.unitKind("answer")
			}))), h(FilterButton, {
				kind: "tool",
				state: unitFilterState(prefs.enabledUnitKinds, "tool"),
				onClick: () => toggleUnitKind("tool"),
				text
			})), h("label", { className: "context-editor__toggle" }, h("input", {
				type: "checkbox",
				checked: prefs.showHidden,
				onChange: (event) => updatePrefs({ showHidden: event.target.checked })
			}), text.showHidden)), h("div", { className: "context-editor__searchbar" }, h("input", {
				ref: searchInput,
				type: "search",
				value: query,
				placeholder: text.searchPlaceholderForScope(searchScope),
				onChange: (event) => setQuery(event.target.value),
				"aria-label": text.searchAria
			}), h("button", {
				type: "button",
				className: "context-editor__search-scope",
				onClick: toggleSearchScope,
				"aria-pressed": searchScope === "all"
			}, text.searchScope(searchScope)), h("span", { className: "context-editor__search-summary" }, search?.error ? text.searchFailed(errorText(search.error)) : search ? text.searchSummary(search.total, search.totalOccurrences, match?.occurrenceCount, searchIndex, true, searchScope) : text.searchSummary(0, 0, void 0, 0, false, searchScope)), h("button", {
				type: "button",
				disabled: !search || search.error || search.total < 1 || matching,
				onClick: () => void moveMatch(-1)
			}, text.previous), h("button", {
				type: "button",
				disabled: !search || search.error || search.total < 1 || matching,
				onClick: () => void moveMatch(1)
			}, text.next)), loaded.snapshot?.compatibility ? h("details", { className: "context-editor__more" }, h("summary", null, text.more), h("details", { className: "context-editor__compatibility" }, h("summary", null, text.diagnostics), h("span", null, text.compatibilitySummary(loaded.snapshot.compatibility)), loaded.snapshot.requestRouting ? h("pre", null, JSON.stringify(loaded.snapshot.requestRouting, null, 2)) : null, h("button", {
				type: "button",
				disabled: compatibilityCheckLoading,
				onClick: () => void recheckCompatibility()
			}, compatibilityCheckLoading ? text.compatibilityChecking : text.runCompatibilityCheck), compatibilityCheckError ? h("span", { className: "context-editor__error" }, compatibilityCheckError) : null)) : null, h("div", { className: "context-editor__actions" }, h("button", {
				type: "button",
				disabled: readOnly || selectedCount === 0,
				onClick: () => void mutate("hide", [...selected])
			}, text.hideSelected(selectedCount)), h("button", {
				type: "button",
				disabled: readOnly || selectedCount === 0,
				onClick: () => void mutate("restore", [...selected])
			}, text.restoreSelected), h("button", {
				type: "button",
				disabled: readOnly,
				onClick: () => void mutate("reset")
			}, text.restoreAll), h("button", {
				type: "button",
				disabled: readOnly || !contextAvailable || selectedCount === 0,
				title: !contextAvailable ? text.featureUnavailable(contextUnavailableReason) : void 0,
				onClick: () => void mutateContext("exclude", [...selected])
			}, text.excludeSelected(selectedCount)), h("button", {
				type: "button",
				disabled: readOnly || !contextAvailable || selectedCount === 0,
				title: !contextAvailable ? text.featureUnavailable(contextUnavailableReason) : void 0,
				onClick: () => void mutateContext("restore", [...selected])
			}, text.restoreContextSelected), condensationModels.length > 0 ? h("label", { className: "context-editor__condensation-model" }, h("span", null, text.condensationModelPicker), h("select", {
				value: condensationModel,
				disabled: readOnly || !condensationAvailable,
				title: !condensationAvailable ? text.featureUnavailable(loaded.snapshot?.contextCondensationUnavailableReason) : void 0,
				onChange: (event) => setCondensationModel(event.target.value),
				"aria-label": text.condensationModelPicker
			}, condensationModels.map((model) => h("option", {
				key: condensationModelKey(model),
				value: condensationModelKey(model)
			}, `${model.name ?? model.id}`)))) : null, h("button", {
				type: "button",
				className: "context-editor__condensation-action",
				disabled: readOnly || !condensationAvailable || selectedCount === 0,
				title: !condensationAvailable ? text.featureUnavailable(loaded.snapshot?.contextCondensationUnavailableReason) : void 0,
				onClick: openCondensation
			}, condensationLoading ? text.condensationGenerating : text.condenseSelected(selectedCount)), condensationLoading && condensationOperationId ? h("button", {
				type: "button",
				onClick: () => void cancelCondensation()
			}, text.cancelCondensation) : null, h("button", {
				type: "button",
				disabled: readOnly || !loaded.snapshot?.canUndo,
				onClick: () => void undo()
			}, text.undo), running ? h("span", { className: "context-editor__running" }, text.running) : null, loaded.status === "error" ? h("span", {
				className: "context-editor__error",
				role: "alert"
			}, errorText(loaded.error), h("button", {
				type: "button",
				"aria-label": text.dismiss,
				onClick: () => setLoaded((current) => ({
					...current,
					status: "ready",
					error: null
				}))
			}, "×")) : null, notice ? h("span", {
				className: "context-editor__notice",
				role: "status"
			}, notice, operationUnverified ? h("button", {
				type: "button",
				onClick: () => {
					const pending = readPendingReplacement(sessionId);
					if (pending) resolvePendingReplacement(pending.operationId);
				}
			}, text.verifyOperation) : null, !operationUnverified ? h("button", {
				type: "button",
				onClick: () => setNotice(""),
				"aria-label": text.dismiss
			}, "×") : null) : null, condensationError ? h("span", {
				className: "context-editor__error",
				role: "alert"
			}, condensationError, h("button", {
				type: "button",
				onClick: () => setCondensationError(""),
				"aria-label": text.dismiss
			}, "×")) : null)), h("div", { className: "context-editor__list" }, [
				...visibleRecords.flatMap((record) => [Number(record.historyGapBefore) > 0 ? h("div", {
					key: "history-gap-" + record.id,
					className: "context-editor__history-gap",
					role: "separator"
				}, text.unloadedHistory(record.historyGapBefore)) : null, record.condensation ? renderCondensation(record.condensation) : h(RecordRow, {
					key: record.id,
					record,
					selected,
					onSelect: selectUnit,
					focusedUnitId: matchUnitId,
					showHidden: prefs.showHidden,
					showOriginalUnitId: comparisonUnitId,
					match: matchUnitId === match?.unitId ? match : null,
					disabled: readOnly,
					disabledUnitIds: condensedUnitIds,
					onRestore: (unitId) => void mutate("restore", [unitId]),
					onContextToggle: (unit) => void mutateContext(unit.projectionState === "exclude" || unit.projectionState === "mixed" ? "restore" : "exclude", [unit.id]),
					onEdit: openReplacementEdit,
					onRestoreReplacement: (unit) => void mutateReplacement("restore", unit),
					onUndoReplacement: (unit) => void mutateReplacement("undo", unit),
					onCompareOriginal: compareOriginal,
					replacementAvailable,
					contextAvailable,
					contextUnavailableReason,
					registerNode: registerUnitNode,
					text
				})]),
				loaded.snapshot?.recoveryOptions?.length ? h("details", { className: "context-editor__recovery-list" }, h("summary", null, text.nativeCompactionRecovery), ...loaded.snapshot.recoveryOptions.map((option) => h("article", {
					key: "native-recovery-" + option.compactionId,
					className: "context-editor__condensation-card",
					"data-recovery-operation-id": option.compactionId
				}, h("div", { className: "context-editor__condensation-card-header" }, h("strong", null, text.nativeCompactionRecovery), h("span", null, text.nativeCompactionCheckpoint(option.checkpointSeq)), h("button", {
					type: "button",
					disabled: readOnly || !option.available || loaded.snapshot?.capabilities?.nativeCompactionRecovery !== true,
					title: !option.available ? text.recoveryUnavailable(option.reason ?? "recovery-boundary-unavailable") : loaded.snapshot?.capabilities?.nativeCompactionRecovery !== true ? text.featureUnavailable("host-capability-not-confirmed") : void 0,
					onClick: () => void createRecovery({
						kind: "native-compaction",
						compactionId: option.compactionId
					})
				}, text.createRecoveryBranch)), option.summary ? h("pre", { className: "context-editor__condensation-summary" }, option.summary) : null))) : null,
				loaded.nextCursor !== null && loaded.nextCursor !== void 0 ? h("button", {
					type: "button",
					className: "context-editor__history-load-more",
					disabled: historyLoading || loaded.status !== "ready",
					onClick: loadMoreHistory
				}, historyLoading ? text.loadingMore : text.loadMoreHistory(loaded.records.length, loaded.total)) : null
			]), loaded.status === "loading" ? h("div", { className: "context-editor__state" }, text.loading) : null, loaded.status !== "loading" && visibleRecords.length === 0 ? h("div", { className: "context-editor__state" }, text.noRecords) : null, editing ? h(EditDialog, {
				unit: editing,
				initialText: editing.text,
				text,
				onCancel: closeReplacementDialog,
				onSave: saveReplacement
			}) : null, condensation ? h(CondensationDialog, {
				proposal: condensation,
				text,
				saving: condensationLoading,
				generating: generatingCondensation,
				error: condensationError,
				onCancel: () => {
					if (generatingCondensation) cancelCondensation();
					else if (!condensationLoading) discardCondensation();
				},
				onRegenerate: (expandRelated) => {
					if (!condensationLoading) regenerateCondensation(expandRelated);
				},
				onApply: applyCondensation
			}) : null);
		}
		async function apply(ctx) {
			const disposeRemote = await ctx.remote.$mount(contextEditorRemote);
			ctx.inject([
				"slots",
				"remote",
				"remote.contextEditor",
				"uiWorkspace"
			], (scopedCtx) => {
				const controllers = /* @__PURE__ */ new Map();
				const controllerFor = (sessionId) => {
					const key = String(sessionId);
					let controller = controllers.get(key);
					if (controller === void 0) {
						controller = new ContextEditorController(scopedCtx.remote.contextEditor, key);
						controllers.set(key, controller);
					}
					return controller;
				};
				scopedCtx.effect(() => () => {
					for (const controller of controllers.values()) controller.dispose();
					controllers.clear();
				}, "context-editor-deepseek-harness: controllers");
				scopedCtx.slots.inject("conversation.view", () => scopedCtx.slots.register({
					name: "conversation.view",
					id: "context-editor",
					order: 20,
					label: () => "Context Editor",
					inject: (sessionId) => ({
						controller: controllerFor(sessionId),
						openSession: (target) => scopedCtx.uiWorkspace.openSession(target)
					})
				}, ContextEditorView));
			});
			return disposeRemote;
		}
		//#endregion
		exports.ContextEditorController = ContextEditorController;
		exports.ContextEditorView = ContextEditorView;
		exports.apply = apply;
		exports.inject = inject;

    return module.exports;
  },
});
