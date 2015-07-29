'use strict';

var pipeline = require('json-pipeline');
var frontier = require('dominance-frontier');
var BitField = require('bitfield.js');

function Scheduler(input) {
  this.input = input;
  this.output = pipeline.create('dominance');

  // Mapping: input node to output block
  this.block = new Array(this.input.nodes.length);
  for (var i = 0; i < this.block.length; i++)
    this.block[i] = null;

  this.visited = new BitField(this.input.nodes.length);

  // Queue of instructions to schedule
  this.scheduleQueue = [];
}
module.exports = Scheduler;

Scheduler.create = function create(input) {
  return new Scheduler(input);
};

Scheduler.prototype.run = function run() {
  // Construct CFG out of control dependencies
  this.constructCFG();

  // Create dominance checks
  frontier.create(this.output).compute();
  this.output.enumerate();

  // Schedule nodes into blocks
  for (var i = 0; i < this.scheduleQueue.length; i++)
    this.scheduleEarly(this.scheduleQueue[i]);

  this.visited.wipe();
  for (var i = 0; i < this.scheduleQueue.length; i++)
    this.scheduleLate(this.scheduleQueue[i]);

  // Place nodes
  this.place();

  return this.output;
};

Scheduler.prototype.constructCFG = function constructCFG() {
  var queue = [ this.input.nodes[0] ];
  var visited = this.visited;
  while (queue.length !== 0) {
    var node = queue.pop();

    // Visit nodes only once
    if (!visited.set(node.index))
      continue;

    // Create parent block
    var block = this.getBlock(node.index);

    // Queue control nodes
    this.queueControl(block, node);

    // Get `jump` or `if` instruction
    var last = this.getLastIndirection(node);

    // No indirection
    if (last === null)
      continue;

    // Merge point
    if (last.opcode === 'region' || last.opcode === 'start') {
      this.output.setCurrentBlock(block);
      this.output.add('jump');

      block.jump(this.getBlock(last.index));
      queue.push(last);
      continue;
    }

    // Queue and link block successors
    for (var i = 0; i < last.controlUses.length; i += 2) {
      var child = last.controlUses[i];

      block.jump(this.getBlock(child.index));
      queue.push(child);
    }
  }

  return queue;
};

Scheduler.prototype.getBlock = function getBlock(index) {
  if (this.block[index] !== null)
    return this.block[index];

  var block = this.output.block();
  this.block[index] = block;
  return block;
};

Scheduler.prototype.getLastIndirection = function getLastIndirection(node) {
  for (var i = 0; i < node.controlUses.length; i += 2) {
    var use = node.controlUses[i];
    if (use.opcode === 'if' || use.opcode === 'jump')
      return use;
    if (use.opcode === 'region' || use.opcode === 'start')
      return use;
  }
  return null;
};

Scheduler.prototype.queueControl = function queueControl(block, node) {
  for (var i = 0; i < node.controlUses.length; i += 2) {
    var use = node.controlUses[i];
    if (use.opcode === 'region' || use.opcode === 'start')
      continue;

    // Process inputs of control node
    this.scheduleQueue.push(use);

    // Pin control nodes
    this.block[use.index] = block;
  }
};

Scheduler.prototype.scheduleEarly = function scheduleEarly(node) {
  var block = this.block[node.index];

  // Select highest block by default
  if (block === null)
    block = this.output.blocks[0];

  for (var i = 0; i < node.inputs.length; i++) {
    var input = node.inputs[i];
    if (this.block[input.index] === null)
      this.scheduleEarly(input);

    var inputBlock = this.block[input.index];
    if (block.dominates(inputBlock))
      block = inputBlock;
  }

  // Node was pinned, it can't move anymore
  if (this.block[node.index] !== null)
    return;

  this.block[node.index] = block;
};

Scheduler.prototype.scheduleLate = function scheduleLate(node) {
  if (!this.visited.set(node.index))
    return;

  for (var i = 0; i < node.uses.length; i += 2) {
    var use = node.uses[i];
    var isPinned = use.control.length !== 0;
    if (isPinned)
      continue;

    this.scheduleLate(use);
  }

  // Pinned nodes don't move
  if (node.control.length !== 0)
    return;

  // Find lowest common ancestor in dominator tree
  var lca = null;
  for (var i = 0; i < node.uses.length; i += 2) {
    var use = node.uses[i];
    var index = node.uses[i + 1];

    // Use appropriate phi's control input
    if (use.opcode === 'ssa:phi') {
      var controlBlock = this.block[use.control[0].index];
      lca = this.findLCA(lca, controlBlock.predecessors[index]);
    } else {
      lca = this.findLCA(lca, this.block[use.index]);
    }
  }

  // TODO(indutny): move out of loops
  if (lca === null)
    lca = this.block[node.index];
  else
    this.block[node.index] = lca;
};

Scheduler.prototype.findLCA = function LCA(lca, block) {
  if (lca === null)
    return block;

  // Get on the same depth level
  while (lca.dominanceDepth > block.dominanceDepth)
    lca = lca.parent;
  while (lca.dominanceDepth < block.dominanceDepth)
    block = block.parent;

  // Go up until match
  while (lca !== block) {
    lca = lca.parent;
    block = block.parent;
  }

  return lca;
};

Scheduler.prototype.place = function place() {
  var nodes = new Array(this.input.nodes.length);
  for (var i = 0; i < nodes.length; i++)
    nodes[i] = null;

  // Put nodes into blocks
  for (var i = 0; i < this.input.nodes.length; i++) {
    var node = this.input.nodes[i];
    if (node.opcode === 'region' || node.opcode === 'start')
      continue;

    var block = this.block[node.index];
    // Unreachable code
    if (block === null)
      continue;

    this.output.setCurrentBlock(block);
    nodes[node.index] = this.output.add(node.opcode);
  }

  // Assign literal, regular and control inputs
  for (var i = 0; i < this.input.nodes.length; i++) {
    var node = this.input.nodes[i];
    var current = nodes[node.index];
    if (current === null)
      continue;

    for (var j = 0; j < node.literals.length; j++)
      current.addLiteral(node.literals[j]);

    for (var j = 0; j < node.inputs.length; j++)
      current.addInput(nodes[node.inputs[j].index]);

    if (node.control.length === 1) {
      current.setControl(this.block[node.control[0].index]);
    } else if (node.control.length === 2) {
      current.setControl(this.block[node.control[0].index],
                         this.block[node.control[1].index]);
    }
  }

  // Move `jump`s and `if`s to the very end of the block
  for (var i = 0; i < this.output.blocks.length; i++) {
    var block = this.output.blocks[i];

    for (var j = block.nodes.length - 1; j >= 0; j--) {
      var node = block.nodes[j];
      if (node.opcode !== 'if' &&
          node.opcode !== 'return' &&
          node.opcode !== 'jump') {
        continue;
      }

      block.remove(j);
      block.add(node);

      // Only one jump per block
      break;
    }
  }
};
