'use strict';

var assertText = require('assert-text');
var pipeline = require('json-pipeline');

var scheduler = require('../');
var fixtures = require('./fixtures');

assertText.options.trim = true;

describe('JSON Pipeline Scheduler', function() {
  var p;
  beforeEach(function() {
    p = pipeline.create();
  });

  it('should schedule and create CFG', function() {
    var start = p.add('start');
    var body = p.add('region');
    var exit = p.add('region');

    var i0 = p.add('literal').addLiteral(0);
    var a = p.add('read()');

    var phi = p.add('ssa:phi').addInput(i0).setControl(body);
    var one = p.add('literal').addLiteral(1);
    var addOne = p.add('add', [ a, one ]);
    var i2 = p.add('add', [ phi, addOne ]);
    phi.addInput(i2);

    var ten = p.add('literal').addLiteral(10);
    var cc = p.add('le', [ i2, ten ]);
    var branch = p.add('if', cc).setControl(body);

    body.setControl(start, branch);

    var two = p.add('literal').addLiteral(2);
    var mul = p.add('mul', [ i2, two ]);

    exit.setControl(branch);
    var ret = p.add('return', mul).setControl(exit);

    var s = scheduler.create(p);
    var out = s.run();

    var actual = out.render({ cfg: true, dominance: true }, 'printable');
    assertText.equal(actual, fixtures.fn2str(function() {/*
      pipeline {
        b0 {
          i1 = literal 0
          i2 = read()
          i4 = literal 1
          i5 = add i2, i4
          i7 = literal 10
          i10 = literal 2
          i0 = jump
        }
        b0 -> b1
        b0 => b1
        b1 {
          i3 = ssa:phi ^b1, i1, i6
          i6 = add i3, i5
          i8 = le i6, i7
          i9 = if ^b1, i8
        }
        b1 -> b1, b2
        b1 => b2
        b1 ~> b1
        b2 {
          i11 = mul i6, i10
          i12 = return ^b2, i11
        }
      }
    */}));
  });
});
