import { C, Order } from "./comparator.ts";
import { AST_NODE_TYPES } from "@typescript-eslint/types";
import { isNode, isPrivateName, isStringLiteral } from "@babel/types";
import { Node } from "../ast";

export type DataDependencyMap = {
	[key:string]:string[]
};

type DependencyQueueEntry = {
	parent?: string;
	node: Node|null;
};

function queueEntryMapper(cur: DependencyQueueEntry): DependencyQueueEntry {
	return (n) => {
		return {
			parent: cur.parent || extractName(cur.node),
			node: n
		};
	};
}

export const extractDependencies = ($: Node): DataDependencyMap => {
	const map: DataDependencyMap = {};

	// console.log('BASE_NODE: ', JSON.stringify($, undefined, '  '));
	const q: DependencyQueueEntry[] = [{
		node: $
	}];

	while (q.length) {
		const cur = q.shift();
		if (!cur || !cur.node) { continue; }

		switch (cur.node.type) {
			case AST_NODE_TYPES.TSInterfaceBody:
			case AST_NODE_TYPES.ClassBody:
				if (cur.node.body) {
					const el = cur.node.body.map(queueEntryMapper(cur));
					q.push(...el);
				}
				break;

			case AST_NODE_TYPES.TSTypeLiteral:
				if (cur.node.members) {
					const el = cur.node.members.map(queueEntryMapper(cur));
					q.push(...el);
				}
				break;

			case AST_NODE_TYPES.ObjectExpression:
				if (cur.node.properties) {
					const el = cur.node.properties.map(queueEntryMapper(cur));
					q.push(...el);
				}
				break;

			case AST_NODE_TYPES.PropertyDefinition:
			case AST_NODE_TYPES.Property:
				if (cur.node.value) {
					q.push(queueEntryMapper(cur)(cur.node.value));
				}
				break;

			case AST_NODE_TYPES.ArrayExpression:
				if (cur.node.elements) {
					const el = cur.node.elements.map(queueEntryMapper(cur));
					q.push(...el);
				}
				break;

			case AST_NODE_TYPES.CallExpression:
				if (cur.node.callee && cur.node.callee.type == AST_NODE_TYPES.MemberExpression) {
					q.push(queueEntryMapper(cur)(cur.node.callee.object));
				}

				if (cur.node.arguments) {
					const el = cur.node.arguments.map(queueEntryMapper(cur));
					q.push(...el);
				}

				break;

			case AST_NODE_TYPES.MemberExpression:
				if (cur.node?.property?.type == AST_NODE_TYPES.Identifier) {
					if (cur.node.object.type == AST_NODE_TYPES.ThisExpression) {
						if (cur.parent) {
							let deps = map[cur.parent];
							if (!deps) {
								deps = [];
								map[cur.parent] = deps;
							}

							let dep_name = cur.node.property.name;
							if (dep_name.endsWith('?')) {
								dep_name = dep_name.slice(0, -1);
							}

							deps.push(dep_name);
						}
					}
					else if (cur.node.object.type == AST_NODE_TYPES.MemberExpression) {
						q.push({
							parent: cur.parent || extractName(cur.node),
							node: cur.node.object
						});
					}
				}
				break;

			case AST_NODE_TYPES.ChainExpression:
			case AST_NODE_TYPES.TSAsExpression:
				if (cur.node.expression) {
					q.push(queueEntryMapper(cur)(cur.node.expression));
				}
				break;

			// default:
			// 	console.log('UNKNOWN TYPE: ', cur.node.type);
		}
	}

	// Extract out transitive dependencies.
	let modified = false;
	const keys = Object.keys(map);
	do {
		modified = false;

		for (const k of keys) {
			let with_transitives = [...map[k]];

			for (const d of map[k]) {
				const d_deps = map[d];
				if (d_deps) {
					with_transitives = with_transitives.concat(d_deps);
				}
			}

			// Perform deduplication.
			const seen: {[key:string]: boolean} = {};
			with_transitives = with_transitives.filter(d => {
				const d_seen = seen[d];
				if (d_seen) { return false; }

				seen[d] = true;
				return true;
			})
				.sort();

			// Check for modification.
			const original = map[k].sort();

			const has_change = original.length != with_transitives.length
				|| !with_transitives.every((v, i) => v === original[i]);

			if (has_change) {
				modified = true;

				map[k] = with_transitives;
			}
		}
	} while (modified);

	// console.log('DEP MAP FOR : ', JSON.stringify(map, undefined, '    '));

	return map;
};

export function extractName ($: Node) {
	if ("key" in $) {
		switch ($.key.type) {
			case AST_NODE_TYPES.Identifier:
			case AST_NODE_TYPES.PrivateIdentifier:
				if ("computed" in $ && $.computed === true) return undefined;
				return $.key.name;
			case AST_NODE_TYPES.Literal: {
				const value = $.key.value;
				if (typeof value !== "string") return undefined;
				return value;
			}
		}
		if (isNode($.key)) {
			// babel nodes
			switch (true) {
				case isPrivateName($.key):
					if ($.key.id.type !== AST_NODE_TYPES.Identifier) return undefined;
					return $.key.id.name;
				case isStringLiteral($.key):
					return $.key.value;
			}
		}
	}

	return undefined;
}

export const dataDependency = (dependencyMap: DataDependencyMap) =>
	C.by(($: Node) => {
		const name = extractName($);

		let deps: string[] = [];
		if (name) {
			deps = dependencyMap[name] ?? [];
		}

		return {
			name: name,
			dependencies: deps
		};
	}, (a, b) => {
		if (a.dependencies.length === 0 && b.dependencies.length === 0) {
			return Order.Equal;
		}

		// Is a dependent on b?
		if (a && a.dependencies && a.dependencies.indexOf && a.dependencies.indexOf(b.name!) !== -1) {
			// console.log('CMP: ', a.name, ' depends on ', b.name);
			return Order.Greater;
		}

		// Is b dependent on a?
		if (b && b.dependencies && b.dependencies.indexOf && b.dependencies.indexOf(a.name!) !== -1) {
			// console.log('CMP: ', b.name, ' depends on ', a.name);
			return Order.Less;
		}

		// console.log('CMP: ', a.name, ' same level as ', b.name);

		if (a.dependencies.length <= b.dependencies.length) {
			return Order.Less;
		}

		if (b.dependencies.length <= a.dependencies.length) {
			return Order.Greater;
		}

		return Order.Equal;
	});

export const isAngularInject = ($: Node) => {
	if ($?.type !== AST_NODE_TYPES.PropertyDefinition) {
		return false;
	}

	if ($?.value?.type !== AST_NODE_TYPES.CallExpression) {
		return false;
	}

	return ($?.value?.callee?.name === "inject");
};

export const isReadOnlyProperty = ($: Node) => {
	if ($?.type !== AST_NODE_TYPES.PropertyDefinition) {
		return false;
	}

	return $?.readonly;
}
