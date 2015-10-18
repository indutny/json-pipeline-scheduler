'use strict';

var pipeline = require('json-pipeline');
var frontier = require('dominance-frontier');
var debug = require('debug')('json-pipeline-scheduler');
var BitField = require('bitfield.js');

function Scheduler(input) {
  this.input = input;
  this.output = pipeline.create('dominance');

  // Mapping: input node to output block
  this.blocks = new Array(this.input.nodes.length);
  for (var i = 0; i < this.blocks.length; i++)
    this.blocks[i] = null;

  this.nodes = new Array(this.input.nodes.length);
  for (var i = 0; i < this.nodes.length; i++)
    this.nodes[i] = null;

  // Mapping output node index to input node
  this.originalNodes = new Array(this.input.nodes.length);

  this.visited = new BitField(this.input.nodes.length);

  // Queue of instructions to schedule
  this.scheduleQueue = [];
}
module.exports = Scheduler;

Scheduler.create = function create(input) {
  return new Scheduler(input);
};

Scheduler.prototype.run = function run() {
  debug('run');

  // Construct CFG out of control dependencies
  this.constructCFG();

  debug('constructed CFG');

  // Create dominance checks
  frontier.create(this.output).compute();

  debug('computed frontier');

  // Schedule nodes into blocks
  for (var i = 0; i < this.scheduleQueue.length; i++)
    this.scheduleEarly(this.scheduleQueue[i]);

  debug('scheduled early');

  this.visited.wipe();
  // Schedule control and their uses as late as possible
  for (var i = 0; i < this.scheduleQueue.length; i++)
    this.scheduleLate(this.scheduleQueue[i]);

  debug('scheduled late');

  // Schedule the rest
  for (var i = 0; i < this.input.nodes.length; i++) {
    var node = this.input.nodes[i];

    // Pick-up only live blocks
    if (this.blocks[node.index] !== null)
      this.scheduleLate(node);
  }

  debug('scheduled rest');

  // Place nodes
  for (var i = 0; i < this.scheduleQueue.length; i++)
    this.place(this.scheduleQueue[i]);

  debug('placed nodes');

  // Move jump nodes to the end of the blocks
  this.moveControl();
  this.output.computeLastControl();
  this.output.link();

  debug('moved control');

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

    // Create parent blocks
    var block = this.getBlock(node);

    // Queue control nodes
    var last = this.queueControl(block, node);

    // No indirection
    if (last === null)
      continue;

    // Queue and link block successors
    for (var i = 0; i < last.controlUses.length; i += 2) {
      var child = last.controlUses[i];

      block.jump(this.getBlock(child));
    }

    // Queue children in reverse order, because we `pop` from the end of `queue`
    for (var i = last.controlUses.length - 2; i >= 0; i -= 2) {
      var child = last.controlUses[i];
      queue.push(child);
    }
  }

  return queue;
};

Scheduler.prototype.getBlock = function getBlock(node) {
  if (this.blocks[node.index] !== null)
    return this.blocks[node.index];

  var block = this.output.block();
  this.blocks[node.index] = block;
  return block;
};

Scheduler.prototype.queueControl = function queueControl(block, node) {
  var queue = [ ];
  for (var i = 0; i < node.controlUses.length; i += 2) {
    var subuse = node.controlUses[i];
    queue.push(node, subuse);
  }

  var last = null;
  while (queue.length > 0) {
    var use = queue.pop();
    var parent = queue.pop();

    // Prevent loops
    if (use === node)
      continue;

    var isRegion = use.opcode === 'region' || use.opcode === 'start';

    // Record link to the next region
    if (isRegion) {
      last = parent;
      continue;
    }

    for (var i = 0; i < use.controlUses.length; i += 2) {
      var subuse = use.controlUses[i];
      queue.push(use, subuse);
    }

    // Process inputs of control node
    this.scheduleQueue.push(use);

    // Pin control nodes
    this.blocks[use.index] = block;
  }
  return last;
};

Scheduler.prototype.scheduleEarly = function scheduleEarly(node) {
  var block = this.blocks[node.index];

  // Select highest block by default
  if (block === null)
    block = this.output.blocks[0];

  for (var i = 0; i < node.inputs.length; i++) {
    var input = node.inputs[i];
    if (this.blocks[input.index] === null)
      this.scheduleEarly(input);

    var inputBlock = this.blocks[input.index];
    if (block.dominates(inputBlock))
      block = inputBlock;
  }

  // Node was pinned, it can't move anymore
  if (this.blocks[node.index] !== null)
    return;

  this.blocks[node.index] = block;
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

    // Skip unreachable uses
    var useBlock = this.blocks[use.index];
    if (useBlock === null)
      continue;

    // Use appropriate phi's control input
    if (use.opcode === 'ssa:phi') {
      var controlBlock = this.blocks[use.control[0].index];
      lca = this.findLCA(lca, controlBlock.predecessors[index]);
    } else {
      lca = this.findLCA(lca, useBlock);
    }
  }

  // TODO(indutny): move out of loops
  if (lca === null)
    return;

  var best = lca;
  var worst = this.blocks[node.index];
  while (lca !== worst.parent && lca !== null) {
    if (lca.loopDepth < best.loopDepth)
      best = lca;
    lca = lca.parent;
  }
  this.blocks[node.index] = best;
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

Scheduler.prototype.place = function place(node) {
  // Already placed
  if (this.nodes[node.index] !== null)
    return;

  // Place control inputs first
  // TODO(indutny): ideally `scheduleQueue` should be already sorted properly
  for (var i = 0; i < node.control.length; i++) {
    var control = node.control[i];
    if (control.opcode === 'region' || control.opcode === 'start')
      continue;
    this.place(control);
  }

  var current = this.output.create(node.opcode);
  this.originalNodes[current.index] = node;
  this.nodes[node.index] = current;

  // Place inputs
  if (node.opcode !== 'ssa:phi')
    for (var i = 0; i < node.inputs.length; i++)
      this.place(node.inputs[i]);

  var block = this.blocks[node.index];
  block.add(current);

  // Place phi inputs after placing phi: they are either in other blocks,
  // or represent the value from the loop's back edge
  if (node.opcode === 'ssa:phi')
    for (var i = 0; i < node.inputs.length; i++)
      this.place(node.inputs[i]);

  // Assign literals
  for (var i = 0; i < node.literals.length; i++)
    current.addLiteral(node.literals[i]);

  for (var i = 0; i < node.inputs.length; i++)
    current.addInput(this.nodes[node.inputs[i].index]);

  if (node.control.length === 0)
    return;

  if (node.control.length === 1) {
    current.setControl(this.getControlNode(node.control[0]));
  } else if (node.control.length === 2) {
    current.setControl(this.getControlNode(node.control[0]),
                       this.getControlNode(node.control[1]));
  }
};

Scheduler.prototype.getControlNode = function getControlNode(original) {
  if (original.opcode === 'start' || original.opcode === 'region')
    return this.blocks[original.index];

  var res = this.nodes[original.index];
  if (res !== null)
    return res;
  this.place(original);
  return this.nodes[original.index];
};

Scheduler.prototype.isLastControl = function isLastControl(node) {
  var original = this.originalNodes[node.index];
  var controlsRegion = false;
  for (var k = 0;
       !controlsRegion && k < original.controlUses.length;
       k += 2) {
    var use = original.controlUses[k];
    controlsRegion = use.opcode === 'region' || use.opcode === 'start';
  }

  return controlsRegion;
};

Scheduler.prototype.moveControl = function moveControl() {
  for (var i = 0; i < this.output.blocks.length; i++) {
    var block = this.output.blocks[i];

    for (var j = block.nodes.length - 1; j >= 0; j--) {
      var node = block.nodes[j];
      if (!node.isControl())
        continue;

      if (!this.isLastControl(node) && node.opcode !== 'exit')
        continue;

      block.remove(j);
      block.add(node);

      // Only one jump per block
      break;
    }
  }
};
