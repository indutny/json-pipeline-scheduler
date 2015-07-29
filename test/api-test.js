'use strict';

var assertText = require('assert-text');
var pipeline = require('json-pipeline');

var scheduler = require('../');
var fixtures = require('./fixtures');

assertText.options.trim = true;

describe('JSON Pipeline Scheduler', function() {
  fixtures.test('example from Click\'s thesis', function(p) {
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
  }, function() {/*
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
  */});

  fixtures.test('merge/branch', function(p) {
    var start = p.add('start');
    var t = p.add('literal').addLiteral(true);
    var branch = p.add('if', t).setControl(start);

    var left = p.add('region').setControl(branch);

    var leftValue = p.add('literal').addLiteral('left');

    var right = p.add('region').setControl(branch);

    var rightValue = p.add('literal').addLiteral('right');

    var merge = p.add('region').setControl(left, right);
    var phi = p.add('ssa:phi', [ leftValue, rightValue ]).setControl(merge);
    var ret = p.add('return', phi).setControl(merge);
  }, function() {/*
    pipeline {
      b0 {
        i2 = literal true
        i4 = literal "left"
        i5 = literal "right"
        i3 = if ^b0, i2
      }
      b0 -> b1, b2
      b0 => b3, b1, b2
      b1 {
        i1 = jump
      }
      b1 -> b3
      b1 ~> b3
      b2 {
        i0 = jump
      }
      b2 -> b3
      b2 ~> b3
      b3 {
        i6 = ssa:phi ^b3, i4, i5
        i7 = return ^b3, i6
      }
    }
  */});
});
