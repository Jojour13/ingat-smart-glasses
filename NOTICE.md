# Third-party notices

## face-api.js

`js/face-api.min.js` and every file in `models/` come from
[face-api.js](https://github.com/justadudewhohacks/face-api.js) by Vincent Mühler,
licensed under the MIT License.

They are vendored rather than loaded from a CDN so that the application makes no
network request at run time. That is not a packaging preference — it is the
privacy claim. No face data leaves the machine, and you can verify it by
unplugging the network.

Models included:

| File | Purpose |
|---|---|
| `tiny_face_detector_model-*` | Face detection |
| `face_landmark_68_tiny_model-*` | Landmark alignment |
| `face_recognition_model-*` | 128-dimension face descriptors |

```
MIT License

Copyright (c) 2018 Vincent Mühler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Everything else

All other code in this repository is original work by the project team.

## Not affiliated with Huawei

This project was built for the Huawei Tech4City Competition 2026. It is an
independent entry and is not endorsed by, affiliated with, or an official
product of Huawei Technologies. Product names referenced in documentation
belong to their respective owners.
