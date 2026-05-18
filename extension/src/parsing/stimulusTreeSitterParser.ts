import * as path from 'path';
import * as vscode from 'vscode';
import type * as TreeSitter from 'web-tree-sitter';
import {
    STIMULUS_VALUE_TYPES,
    StimulusAction,
    StimulusController,
    StimulusValue,
    StimulusValueType
} from '../hotwire/types';
import { TreeSitterRuntime } from './treeSitterRuntime';

const EXCLUDED_ACTIONS = new Set([
    'constructor',
    'connect',
    'disconnect',
    'initialize'
]);

export class StimulusTreeSitterParser {
    constructor(private readonly runtime: TreeSitterRuntime) {}

    async parseController(content: string, filePath: string, mtime: number): Promise<StimulusController | null> {
        const controllerName = this.extractControllerName(filePath);
        if (!controllerName) {
            return null;
        }

        const language = filePath.endsWith('.ts') ? 'typescript' : 'javascript';
        const tree = await this.runtime.parse(language, content);

        try {
            if (!this.isStimulusControllerTree(tree.rootNode)) {
                return null;
            }

            return {
                name: controllerName,
                filePath,
                uri: vscode.Uri.file(filePath),
                targets: this.extractStaticArray(tree.rootNode, 'targets'),
                values: this.extractValues(tree.rootNode),
                outlets: this.extractStaticArray(tree.rootNode, 'outlets'),
                classes: this.extractStaticArray(tree.rootNode, 'classes'),
                actions: this.extractActions(tree.rootNode),
                mtime
            };
        } finally {
            tree.delete();
        }
    }

    async isValidController(content: string, filePath: string): Promise<boolean> {
        const language = filePath.endsWith('.ts') ? 'typescript' : 'javascript';
        const tree = await this.runtime.parse(language, content);
        try {
            return this.isStimulusControllerTree(tree.rootNode);
        } finally {
            tree.delete();
        }
    }

    extractControllerName(filePath: string): string | null {
        const basename = path.basename(filePath);
        const match = basename.match(/^(.+)_controller\.(js|ts)$/);
        if (!match) {
            return null;
        }

        const controllersMatch = filePath.match(/controllers[\/\\](.+)_controller\.(js|ts)$/);
        if (controllersMatch) {
            return controllersMatch[1].replace(/[\/\\]/g, '--').replace(/_/g, '-');
        }

        return match[1].replace(/_/g, '-');
    }

    private isStimulusControllerTree(root: TreeSitter.Node): boolean {
        let hasStimulusImport = false;
        let extendsController = false;

        const visit = (node: TreeSitter.Node): void => {
            if (node.type === 'import_statement') {
                const importText = node.text;
                if (importText.includes('@hotwired/stimulus') || importText.includes('"stimulus"') || importText.includes("'stimulus'")) {
                    hasStimulusImport = true;
                }
            }

            if (node.type === 'class_heritage' && /\bController\b/.test(node.text)) {
                extendsController = true;
            }

            for (const child of node.namedChildren) {
                visit(child);
            }
        };

        visit(root);
        return hasStimulusImport || extendsController;
    }

    private extractStaticArray(root: TreeSitter.Node, propertyName: string): string[] {
        const field = this.findStaticField(root, propertyName);
        const arrayNode = field?.namedChildren.find(child => child.type === 'array');
        if (!arrayNode) {
            return [];
        }

        return arrayNode.namedChildren
            .filter(child => child.type === 'string')
            .map(child => this.stringValue(child))
            .filter((value): value is string => !!value);
    }

    private extractValues(root: TreeSitter.Node): StimulusValue[] {
        const field = this.findStaticField(root, 'values');
        const objectNode = field?.namedChildren.find(child => child.type === 'object');
        if (!objectNode) {
            return [];
        }

        const values: StimulusValue[] = [];
        for (const pair of objectNode.namedChildren.filter(child => child.type === 'pair')) {
            const key = pair.childForFieldName('key')?.text;
            const value = pair.childForFieldName('value');
            if (!key || !value) {
                continue;
            }

            if (value.type === 'identifier' && this.isStimulusValueType(value.text)) {
                values.push({ name: key, type: value.text as StimulusValueType });
                continue;
            }

            if (value.type === 'object') {
                const typePair = this.findObjectPair(value, 'type');
                const defaultPair = this.findObjectPair(value, 'default');
                const typeNode = typePair?.childForFieldName('value');

                if (typeNode && this.isStimulusValueType(typeNode.text)) {
                    values.push({
                        name: key,
                        type: typeNode.text as StimulusValueType,
                        defaultValue: defaultPair?.childForFieldName('value')?.text
                    });
                }
            }
        }

        return values;
    }

    private extractActions(root: TreeSitter.Node): StimulusAction[] {
        const actions: StimulusAction[] = [];
        const classBodies = root.descendantsOfType('class_body');

        for (const body of classBodies) {
            for (const member of body.namedChildren) {
                if (member.type === 'method_definition') {
                    const nameNode = member.namedChildren.find(child => child.type === 'property_identifier');
                    if (nameNode && this.isActionName(nameNode.text)) {
                        actions.push({
                            name: nameNode.text,
                            line: nameNode.startPosition.row + 1,
                            parameters: this.extractParameters(member.childForFieldName('parameters') || this.findParameters(member))
                        });
                    }
                }

                if ((member.type === 'field_definition' || member.type === 'public_field_definition') && member.text.includes('=>')) {
                    const nameNode = member.namedChildren.find(child => child.type === 'property_identifier');
                    if (nameNode && this.isActionName(nameNode.text)) {
                        actions.push({
                            name: nameNode.text,
                            line: nameNode.startPosition.row + 1,
                            parameters: this.extractParameters(this.findParameters(member))
                        });
                    }
                }
            }
        }

        return actions;
    }

    private findStaticField(root: TreeSitter.Node, propertyName: string): TreeSitter.Node | undefined {
        return root.descendantsOfType(['field_definition', 'public_field_definition'])
            .find(node => {
                if (!/^\s*static\s+/.test(node.text)) {
                    return false;
                }

                const propertyNode = node.namedChildren.find(child => child.type === 'property_identifier');
                return propertyNode?.text === propertyName;
            });
    }

    private findObjectPair(objectNode: TreeSitter.Node, keyName: string): TreeSitter.Node | undefined {
        return objectNode.namedChildren
            .filter(child => child.type === 'pair')
            .find(pair => pair.childForFieldName('key')?.text === keyName);
    }

    private findParameters(node: TreeSitter.Node): TreeSitter.Node | null {
        return node.descendantsOfType('formal_parameters')[0] || null;
    }

    private extractParameters(parametersNode: TreeSitter.Node | null): string[] | undefined {
        if (!parametersNode) {
            return undefined;
        }

        const params = parametersNode.descendantsOfType('identifier')
            .map(node => node.text)
            .filter(Boolean);

        return params.length > 0 ? params : undefined;
    }

    private stringValue(node: TreeSitter.Node): string | undefined {
        const fragment = node.descendantsOfType('string_fragment')[0];
        return fragment?.text;
    }

    private isStimulusValueType(value: string): boolean {
        return STIMULUS_VALUE_TYPES.includes(value as StimulusValueType);
    }

    private isActionName(methodName: string): boolean {
        return !methodName.startsWith('_')
            && !EXCLUDED_ACTIONS.has(methodName)
            && !methodName.endsWith('Target')
            && !methodName.endsWith('Targets')
            && !methodName.endsWith('Value')
            && !methodName.endsWith('Values')
            && !methodName.endsWith('Outlet')
            && !methodName.endsWith('Outlets')
            && !methodName.endsWith('Class')
            && !methodName.endsWith('Classes')
            && !methodName.startsWith('has');
    }
}
